\xEF\xBB\xBF//+------------------------------------------------------------------+
//|                                           EA_Wey_XAUUSD_SMC.mq5   |
//|  Smart Money Concepts para XAUUSD (oro)                           |
//|                                                                   |
//|  Flujo de la estrategia:                                          |
//|   1) Sesgo HTF (estructura H1 o EMA): solo opera a favor.         |
//|   2) BOS/MSS: cierre de vela que rompe un swing, con              |
//|      desplazamiento (cuerpo grande vs ATR) y pierna minima.       |
//|   3) Order Block = ultima vela contraria antes del impulso.       |
//|      Confluencias: FVG en el impulso, barrido de liquidez en el   |
//|      origen, Premium/Discount.                                    |
//|   4) Entrada: el precio vuelve al OB y cierra con rechazo.        |
//|   5) SL tras el OB, TP por RR, parcial + BE a 1R.                 |
//|                                                                   |
//|  Recomendado: XAUUSD, grafico M15, sesgo H1.                      |
//+------------------------------------------------------------------+
#property copyright "Wey 2026"
#property version   "2.00"
#property description "SMC XAUUSD: sesgo HTF + BOS + Order Block + FVG/Sweep + Premium/Discount"

#include <Trade/Trade.mqh>

CTrade trade;

//=========================== ENUMS ================================//
enum ENUM_BIAS_MODE { BIAS_OFF=0, BIAS_STRUCTURE=1, BIAS_EMA=2 };
enum ENUM_OB_ZONE   { OB_FULL=0, OB_BODY=1 };

//========================== INPUTS ================================//
input group "=== General ==="
input long             MagicNumber        = 880011;
input ENUM_TIMEFRAMES  HTF_Bias           = PERIOD_H1;      // TF del sesgo
input ENUM_BIAS_MODE   BiasMode           = BIAS_STRUCTURE; // Off / Estructura / EMA
input int              HTFSwingStrength   = 3;              // fractal HTF (velas a cada lado)
input int              EMAPeriod          = 100;            // solo si BiasMode = EMA

input group "=== Estructura / Order Block (TF del grafico) ==="
input int              SwingStrength      = 3;              // fractal (velas a cada lado)
input int              SwingLookback      = 80;             // velas hacia atras para buscar swings
input int              ATRPeriod          = 14;
input double           DisplacementATR    = 0.9;            // cuerpo minimo de la vela de impulso (x ATR)
input double           MinLegATR          = 1.5;            // tamano minimo del impulso (x ATR)
input ENUM_OB_ZONE     OBZone             = OB_FULL;        // zona = rango completo o solo cuerpo
input double           EntryDepthPct      = 50.0;           // profundidad en el OB (0=borde, 50=mitad)
input bool             RequireRejection   = true;           // exigir vela de rechazo al tocar
input int              ZoneMaxAgeBars     = 48;             // vida maxima de la zona (velas)
input int              MaxActiveZones     = 6;

input group "=== Confluencias SMC ==="
input bool             RequireFVG         = false;          // exigir FVG dentro del impulso
input bool             RequireSweep       = false;          // exigir barrido de liquidez en el origen
input int              SweepLookback      = 15;             // velas previas para el barrido
input bool             UsePremiumDiscount = true;           // comprar en descuento / vender en premium
input int              PDLookback         = 60;             // rango para calcular el equilibrio

input group "=== Riesgo ==="
input double           RiskPercent        = 0.5;            // % del balance por operacion
input double           RR                 = 2.0;            // TP = RR x riesgo
input double           SLBufferATR        = 0.15;           // colchon del SL tras la zona (x ATR)
input double           MinSL_ATR          = 0.5;            // SL minimo (x ATR)
input double           MaxSL_ATR          = 3.0;            // SL maximo (x ATR)
input double           BreakEvenAtR       = 1.0;            // mover a BE al llegar a X R (0 = off)
input double           PartialClosePct    = 50.0;           // % que se cierra a BreakEvenAtR (0 = off)
input int              MaxOpenPositions   = 1;
input int              MaxTradesPerDay    = 3;
input double           DailyLossPercent   = 3.0;            // bloquea entradas si el dia pierde X% (0 = off)

input group "=== Filtros (horas = hora del SERVIDOR del broker) ==="
input bool             UseSession         = true;
input int              SessionStartHour   = 9;              // Londres aprox (broker GMT+2/+3)
input int              SessionEndHour     = 19;             // cierre del solape NY aprox
input int              FridayNoEntryHour  = 18;             // sin entradas viernes desde esta hora (0 = off)
input int              FridayCloseHour    = 0;              // cerrar todo viernes desde esta hora (0 = off)
input int              MaxSpreadPoints    = 60;             // spread maximo en puntos
input double           MaxSpreadPctSL     = 15.0;           // spread maximo como % del SL
input int              DeviationPoints    = 30;

input group "=== Visual / Debug ==="
input bool             DrawObjects        = true;
input bool             Verbose            = false;

//========================== GLOBALS ================================//
struct SMCZone
{
   int      dir;       // +1 compra, -1 venta
   double   top;
   double   bottom;
   datetime t;         // hora de la vela del OB
   int      age;       // velas desde que se creo
   bool     fvg;
   bool     sweep;
};

SMCZone  zones[];
int      atrHandle   = INVALID_HANDLE;
int      emaHandle   = INVALID_HANDLE;
datetime lastBarTime = 0;
datetime biasBarTime = 0;
int      biasDir     = 0;     // +1 alcista, -1 bajista, 0 neutral

//=========================== UTILS ================================//
void Log(const string s)
{
   if(Verbose) Print("[SMC] ", s);
}

bool IsNewBar()
{
   datetime t = iTime(_Symbol, _Period, 0);
   if(t == 0) return false;
   if(t != lastBarTime) { lastBarTime = t; return true; }
   return false;
}

double GetATR(const int shift)
{
   if(atrHandle == INVALID_HANDLE) return 0;
   double b[1];
   if(CopyBuffer(atrHandle, 0, shift, 1, b) != 1) return 0;
   return b[0];
}

string ZoneName(const SMCZone &z)
{
   return "SMC_" + (z.dir > 0 ? "B_" : "S_") + IntegerToString((long)z.t);
}

//======================== INIT / DEINIT ===========================//
int OnInit()
{
   if(SwingStrength < 1 || HTFSwingStrength < 1 || RR <= 0 || RiskPercent <= 0 || MaxOpenPositions < 1)
   {
      Print("Parametros invalidos");
      return INIT_PARAMETERS_INCORRECT;
   }

   atrHandle = iATR(_Symbol, _Period, ATRPeriod);
   if(atrHandle == INVALID_HANDLE) { Print("No se pudo crear ATR"); return INIT_FAILED; }

   if(BiasMode == BIAS_EMA)
   {
      emaHandle = iMA(_Symbol, HTF_Bias, EMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(emaHandle == INVALID_HANDLE) { Print("No se pudo crear EMA"); return INIT_FAILED; }
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(_Symbol);

   string s = _Symbol;
   StringToUpper(s);
   if(StringFind(s, "XAU") < 0 && StringFind(s, "GOLD") < 0)
      Print("AVISO: este EA esta pensado para XAUUSD, simbolo actual: ", _Symbol);
   if(PeriodSeconds(HTF_Bias) <= PeriodSeconds(_Period))
      Print("AVISO: el TF del sesgo deberia ser mayor que el TF del grafico");

   ArrayResize(zones, 0);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(atrHandle != INVALID_HANDLE) IndicatorRelease(atrHandle);
   if(emaHandle != INVALID_HANDLE) IndicatorRelease(emaHandle);
   ObjectsDeleteAll(0, "SMC_");
}

//====================== SESION / LIMITES ==========================//
bool InSession()
{
   MqlDateTime d;
   TimeToStruct(TimeCurrent(), d);
   if(d.day_of_week == 0 || d.day_of_week == 6) return false;
   if(FridayNoEntryHour > 0 && d.day_of_week == 5 && d.hour >= FridayNoEntryHour) return false;
   if(!UseSession) return true;
   if(SessionStartHour < SessionEndHour)
      return (d.hour >= SessionStartHour && d.hour < SessionEndHour);
   return (d.hour >= SessionStartHour || d.hour < SessionEndHour);
}

int CountOurPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      c++;
   }
   return c;
}

double OurFloating()
{
   double p = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      p += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   return p;
}

// Resultado cerrado del dia (hora servidor) y numero de entradas del EA hoy
void DayStats(double &closedPnL, int &entries)
{
   closedPnL = 0;
   entries   = 0;
   MqlDateTime d;
   TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   datetime from = StructToTime(d);
   if(!HistorySelect(from, TimeCurrent() + 86400)) return;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      if((long)HistoryDealGetInteger(tk, DEAL_MAGIC) != MagicNumber) continue;
      if(HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long type = HistoryDealGetInteger(tk, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;

      closedPnL += HistoryDealGetDouble(tk, DEAL_PROFIT)
                 + HistoryDealGetDouble(tk, DEAL_SWAP)
                 + HistoryDealGetDouble(tk, DEAL_COMMISSION)
                 + HistoryDealGetDouble(tk, DEAL_FEE);
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) entries++;
   }
}

bool CanTradeNow()
{
   if(!InSession())                              { Log("fuera de sesion");        return false; }
   if(CountOurPositions() >= MaxOpenPositions)   { Log("posicion abierta");       return false; }
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > MaxSpreadPoints) { Log("spread alto"); return false; }

   double closed; int entries;
   DayStats(closed, entries);
   if(entries >= MaxTradesPerDay)                { Log("max trades/dia");         return false; }

   if(DailyLossPercent > 0)
   {
      double pnl    = closed + OurFloating();
      double refBal = AccountInfoDouble(ACCOUNT_BALANCE) - closed;
      if(pnl <= -refBal * DailyLossPercent / 100.0) { Log("limite perdida diaria"); return false; }
   }
   return true;
}

//======================= SWINGS / SERIES ==========================//
// Fractales confirmados. Indices = shift (0 = vela en formacion, nunca se usa).
// hi[] y lo[] quedan ordenados del mas reciente al mas antiguo.
void FindSwings(const double &H[], const double &L[], const int n, const int st,
                const int maxSw, int &hi[], int &lo[])
{
   ArrayResize(hi, 0);
   ArrayResize(lo, 0);
   for(int i = st + 1; i < n - st; i++)
   {
      bool isH = true, isL = true;
      for(int j = 1; j <= st; j++)
      {
         if(!(H[i] > H[i-j] && H[i] >= H[i+j])) isH = false;
         if(!(L[i] < L[i-j] && L[i] <= L[i+j])) isL = false;
         if(!isH && !isL) break;
      }
      if(isH && ArraySize(hi) < maxSw) { int k = ArraySize(hi); ArrayResize(hi, k+1); hi[k] = i; }
      if(isL && ArraySize(lo) < maxSw) { int k = ArraySize(lo); ArrayResize(lo, k+1); lo[k] = i; }
      if(ArraySize(hi) >= maxSw && ArraySize(lo) >= maxSw) break;
   }
}

// Para dir<0 se "espeja" el precio (multiplicado por -1) y asi el mismo
// algoritmo alcista sirve para el caso bajista.
void BuildSeries(const MqlRates &r[], const int n, const int dir,
                 double &O[], double &H[], double &L[], double &C[])
{
   ArrayResize(O, n); ArrayResize(H, n); ArrayResize(L, n); ArrayResize(C, n);
   for(int s = 0; s < n; s++)
   {
      if(dir > 0) { O[s] = r[s].open;  H[s] = r[s].high;  L[s] = r[s].low;   C[s] = r[s].close; }
      else        { O[s] = -r[s].open; H[s] = -r[s].low;  L[s] = -r[s].high; C[s] = -r[s].close; }
   }
}

//============================ SESGO HTF ===========================//
void UpdateBias()
{
   datetime bt = iTime(_Symbol, _Period, 0);
   if(bt == biasBarTime) return;
   biasBarTime = bt;
   biasDir = 0;

   if(BiasMode == BIAS_STRUCTURE)
   {
      const int n = 150;
      MqlRates h[];
      ArraySetAsSeries(h, true);
      if(CopyRates(_Symbol, HTF_Bias, 0, n, h) != n) return;

      double H[], L[];
      ArrayResize(H, n); ArrayResize(L, n);
      for(int s = 0; s < n; s++) { H[s] = h[s].high; L[s] = h[s].low; }

      int hi[], lo[];
      FindSwings(H, L, n, HTFSwingStrength, 4, hi, lo);
      if(ArraySize(hi) < 2 || ArraySize(lo) < 2) return;

      double c1 = h[1].close;
      bool bull = (L[lo[0]] > L[lo[1]]) && (H[hi[0]] > H[hi[1]] || c1 > H[hi[0]]) && c1 > L[lo[0]];
      bool bear = (H[hi[0]] < H[hi[1]]) && (L[lo[0]] < L[lo[1]] || c1 < L[lo[0]]) && c1 < H[hi[0]];
      if(bull && !bear)      biasDir = 1;
      else if(bear && !bull) biasDir = -1;
   }
   else if(BiasMode == BIAS_EMA)
   {
      double e[];
      ArraySetAsSeries(e, true);
      if(CopyBuffer(emaHandle, 0, 1, 4, e) != 4) return;
      double c = iClose(_Symbol, HTF_Bias, 1);
      if(c > e[0] && e[0] > e[3])      biasDir = 1;
      else if(c < e[0] && e[0] < e[3]) biasDir = -1;
   }
}

bool BiasAllows(const int dir)
{
   if(BiasMode == BIAS_OFF) return true;
   UpdateBias();
   return (biasDir == dir);
}

//========================= DIBUJO / ZONAS =========================//
void DrawZone(const SMCZone &z)
{
   if(!DrawObjects) return;
   string nm = ZoneName(z);
   datetime t2 = TimeCurrent() + (datetime)(PeriodSeconds(_Period) * ZoneMaxAgeBars);
   if(ObjectFind(0, nm) < 0)
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, z.t, z.top, t2, z.bottom);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, z.dir > 0 ? clrSeaGreen : clrFireBrick);
   ObjectSetInteger(0, nm, OBJPROP_FILL, false);
   ObjectSetInteger(0, nm, OBJPROP_BACK, true);
   ObjectSetString(0, nm, OBJPROP_TOOLTIP,
                   StringFormat("OB %s%s%s", z.dir > 0 ? "BUY" : "SELL", z.fvg ? " +FVG" : "", z.sweep ? " +SWEEP" : ""));
}

void DrawBOS(const int dir, const datetime t1, const double price, const datetime t2)
{
   if(!DrawObjects) return;
   string nm = "SMC_BOS_" + IntegerToString((long)t2) + (dir > 0 ? "_B" : "_S");
   if(ObjectFind(0, nm) >= 0) return;
   color clr = (dir > 0) ? clrDodgerBlue : clrTomato;
   ObjectCreate(0, nm, OBJ_TREND, 0, t1, price, t2, price);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
   string lb = nm + "_T";
   ObjectCreate(0, lb, OBJ_TEXT, 0, t2, price);
   ObjectSetString(0, lb, OBJPROP_TEXT, "BOS");
   ObjectSetInteger(0, lb, OBJPROP_COLOR, clr);
}

void RemoveZone(const int idx, const bool used = false)
{
   int sz = ArraySize(zones);
   if(idx < 0 || idx >= sz) return;
   if(DrawObjects)
   {
      string nm = ZoneName(zones[idx]);
      if(ObjectFind(0, nm) >= 0)
      {
         ObjectSetInteger(0, nm, OBJPROP_COLOR, used ? clrGold : clrSilver);
         ObjectSetInteger(0, nm, OBJPROP_TIME, 1, TimeCurrent());
      }
   }
   for(int k = idx; k < sz - 1; k++) zones[k] = zones[k+1];
   ArrayResize(zones, sz - 1);
}

//===================== DETECCION DE BOS + OB ======================//
bool BuildZone(const int dir, const int ih, const double lvl, const MqlRates &r[],
               const double &O[], const double &H[], const double &L[], const double &C[],
               const int n, const double atr)
{
   // Origen del impulso: minimo mas bajo entre el swing roto y la vela de ruptura
   int org = -1;
   double minL = DBL_MAX;
   for(int s = 1; s < ih; s++)
      if(L[s] < minL) { minL = L[s]; org = s; }
   if(org < 2) { Log("sin pullback previo"); return false; }

   // Tamano del impulso
   if(C[1] - L[org] < MinLegATR * atr) { Log("impulso pequeno"); return false; }

   // Desplazamiento: al menos una vela de cuerpo grande en el impulso
   double maxBody = 0;
   for(int s = 1; s < org; s++) maxBody = MathMax(maxBody, C[s] - O[s]);
   if(maxBody < DisplacementATR * atr) { Log("sin desplazamiento"); return false; }

   // Order Block: ultima vela contraria en/antes del origen (max 3 velas atras)
   int ob  = org;
   int lim = MathMin(org + 3, ih - 1);
   for(int s = org; s <= lim; s++)
      if(C[s] < O[s]) { ob = s; break; }

   double zTop = (OBZone == OB_FULL) ? H[ob] : MathMax(O[ob], C[ob]);
   double zBot = (OBZone == OB_FULL) ? L[ob] : MathMin(O[ob], C[ob]);
   double h    = zTop - zBot;
   if(h <= 0 || h > MaxSL_ATR * atr) { Log("OB demasiado grande"); return false; }

   double entry = zTop - h * EntryDepthPct / 100.0;

   // Zona ya tocada durante el impulso -> no es fresca
   for(int s = 1; s <= ob - 2; s++)
      if(L[s] <= entry) { Log("OB ya mitigado"); return false; }

   // Confluencia: FVG dentro del impulso
   bool fvg = false;
   for(int s = 2; s <= org && s + 1 < n; s++)
      if(L[s-1] > H[s+1]) { fvg = true; break; }
   if(RequireFVG && !fvg) { Log("sin FVG"); return false; }

   // Confluencia: barrido de liquidez (el origen tomo los minimos previos)
   double pm = DBL_MAX;
   for(int s = org + 1; s <= org + SweepLookback && s < n; s++) pm = MathMin(pm, L[s]);
   bool swept = (pm < DBL_MAX && L[org] < pm);
   if(RequireSweep && !swept) { Log("sin sweep"); return false; }

   // Premium / Discount
   if(UsePremiumDiscount)
   {
      double pdH = -DBL_MAX, pdL = DBL_MAX;
      for(int s = 1; s <= PDLookback && s < n; s++) { pdH = MathMax(pdH, H[s]); pdL = MathMin(pdL, L[s]); }
      if(entry > (pdH + pdL) / 2.0) { Log("OB en zona premium/discount incorrecta"); return false; }
   }

   // Sesgo HTF
   if(!BiasAllows(dir)) { Log("contra sesgo HTF"); return false; }

   // Construir zona en precios reales
   SMCZone z;
   z.dir   = dir;
   z.t     = r[ob].time;
   z.age   = 0;
   z.fvg   = fvg;
   z.sweep = swept;
   if(dir > 0) { z.top = zTop;  z.bottom = zBot;  }
   else        { z.top = -zBot; z.bottom = -zTop; }

   for(int i = 0; i < ArraySize(zones); i++)
      if(zones[i].dir == dir && zones[i].t == z.t) return false;

   if(ArraySize(zones) >= MaxActiveZones) RemoveZone(0);
   int k = ArraySize(zones);
   ArrayResize(zones, k + 1);
   zones[k] = z;

   DrawZone(z);
   DrawBOS(dir, r[ih].time, (dir > 0 ? lvl : -lvl), r[1].time);
   PrintFormat("[SMC] Nueva zona %s  %.2f - %.2f  FVG=%s SWEEP=%s",
               dir > 0 ? "BUY" : "SELL", z.bottom, z.top, fvg ? "si" : "no", swept ? "si" : "no");
   return true;
}

bool DetectZone(const int dir, const MqlRates &r[], const int n, const double atr)
{
   double O[], H[], L[], C[];
   BuildSeries(r, n, dir, O, H, L, C);

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, 6, hi, lo);

   for(int k = 0; k < ArraySize(hi) && k < 5; k++)
   {
      int ih = hi[k];
      if(ih > SwingLookback) break;
      double lvl = H[ih];
      if(C[1] <= lvl) continue;                 // la vela cerrada no rompe este swing

      bool fresh = true;                        // la ruptura debe ser de esta vela
      for(int b = 2; b < ih; b++)
         if(C[b] > lvl) { fresh = false; break; }
      if(!fresh) continue;

      return BuildZone(dir, ih, lvl, r, O, H, L, C, n, atr);
   }
   return false;
}

void ScanForZones()
{
   double atr = GetATR(1);
   if(atr <= 0) return;

   int n = SwingLookback + 2 * SwingStrength + SweepLookback + 10;
   if(PDLookback + 5 > n) n = PDLookback + 5;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) return;

   DetectZone(+1, r, n, atr);
   DetectZone(-1, r, n, atr);
}

//========================= RIESGO / ENTRADA =======================//
double CalcLots(const int dir, const double entry, const double sl)
{
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * RiskPercent / 100.0;
   double dist = MathAbs(entry - sl);
   if(dist <= 0) return 0;

   ENUM_ORDER_TYPE ot = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double profit = 0, lossPerLot = 0;
   if(OrderCalcProfit(ot, _Symbol, 1.0, entry, sl, profit)) lossPerLot = MathAbs(profit);
   if(lossPerLot <= 0)
   {
      double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(ts <= 0 || tv <= 0) return 0;
      lossPerLot = dist / ts * tv;
   }

   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;

   double lots = MathFloor(riskMoney / lossPerLot / step) * step;
   if(lots < minL)
   {
      if(minL * lossPerLot > riskMoney * 2.0)
      {
         Log("lote minimo excede el doble del riesgo -> se omite");
         return 0;
      }
      lots = minL;
   }
   lots = MathMin(lots, maxL);

   double margin = 0;
   if(OrderCalcMargin(ot, _Symbol, lots, entry, margin) && margin > 0)
   {
      double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.8;
      if(margin > freeMargin)
      {
         lots = MathFloor(lots * freeMargin / margin / step) * step;
         if(lots < minL) return 0;
      }
   }
   return NormalizeDouble(lots, 3);
}

bool TryEnter(const SMCZone &z, const double l1, const double h1)
{
   if(!BiasAllows(z.dir)) return false;
   double atr = GetATR(1);
   if(atr <= 0) return false;

   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) return false;

   double buf = SLBufferATR * atr;
   double entry, sl, tp;
   if(z.dir > 0) { entry = t.ask; sl = MathMin(z.bottom, l1) - buf; }
   else          { entry = t.bid; sl = MathMax(z.top,    h1) + buf; }

   double slDist = MathAbs(entry - sl);
   if(slDist < MinSL_ATR * atr) { Log("SL muy corto");  return false; }
   if(slDist > MaxSL_ATR * atr) { Log("SL muy largo");  return false; }
   if((t.ask - t.bid) > MaxSpreadPctSL / 100.0 * slDist) { Log("spread vs SL alto"); return false; }

   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(slDist < minStop) { Log("SL menor al stop level"); return false; }

   tp = (z.dir > 0) ? entry + RR * slDist : entry - RR * slDist;
   sl = NormalizeDouble(sl, _Digits);
   tp = NormalizeDouble(tp, _Digits);

   double lots = CalcLots(z.dir, entry, sl);
   if(lots <= 0) return false;

   string cm = StringFormat("SMC %s%s%s", z.dir > 0 ? "BUY" : "SELL", z.fvg ? " FVG" : "", z.sweep ? " SWP" : "");
   bool ok = (z.dir > 0) ? trade.Buy(lots, _Symbol, 0.0, sl, tp, cm)
                         : trade.Sell(lots, _Symbol, 0.0, sl, tp, cm);
   PrintFormat("[SMC] %s lots=%.2f entry=%.2f SL=%.2f TP=%.2f -> %s (%d)",
               z.dir > 0 ? "BUY" : "SELL", lots, entry, sl, tp,
               ok ? "OK" : "FALLO", (int)trade.ResultRetcode());
   return ok;
}

// Se llama en cada vela nueva. Evalua toque + rechazo sobre la vela recien cerrada.
void CheckZones(const bool allowEntry)
{
   int sz = ArraySize(zones);
   if(sz == 0) return;

   MqlRates b[];
   ArraySetAsSeries(b, true);
   if(CopyRates(_Symbol, _Period, 1, 1, b) != 1) return;
   double o1 = b[0].open, h1 = b[0].high, l1 = b[0].low, c1 = b[0].close;

   for(int i = sz - 1; i >= 0; i--)
   {
      zones[i].age++;

      // Invalidacion: cierre mas alla del borde lejano, o zona vieja
      bool dead = false;
      if(zones[i].dir > 0 && c1 < zones[i].bottom) dead = true;
      if(zones[i].dir < 0 && c1 > zones[i].top)    dead = true;
      if(zones[i].age > ZoneMaxAgeBars)            dead = true;
      if(dead) { RemoveZone(i); continue; }

      if(!allowEntry) continue;

      double h   = zones[i].top - zones[i].bottom;
      double lvl = (zones[i].dir > 0) ? zones[i].top - h * EntryDepthPct / 100.0
                                      : zones[i].bottom + h * EntryDepthPct / 100.0;
      bool tapped = (zones[i].dir > 0) ? (l1 <= lvl) : (h1 >= lvl);
      if(!tapped) continue;

      if(RequireRejection)
      {
         bool rej = (zones[i].dir > 0) ? (c1 > lvl && c1 > o1)
                                       : (c1 < lvl && c1 < o1);
         if(!rej) continue;
      }

      if(TryEnter(zones[i], l1, h1)) { RemoveZone(i, true); break; }
   }
}

//===================== GESTION DE POSICIONES ======================//
void DoPartial(const ulong tk, const double vol)
{
   if(PartialClosePct <= 0) return;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   if(step <= 0) step = 0.01;
   double cv = NormalizeDouble(MathFloor(vol * PartialClosePct / 100.0 / step) * step, 3);
   if(cv < minL || vol - cv < minL) return;
   trade.PositionClosePartial(tk, cv);
}

void ManagePositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

      if(FridayCloseHour > 0)
      {
         MqlDateTime d;
         TimeToStruct(TimeCurrent(), d);
         if(d.day_of_week == 5 && d.hour >= FridayCloseHour) { trade.PositionClose(tk); continue; }
      }

      if(BreakEvenAtR <= 0) continue;

      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      if(sl <= 0) continue;

      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double spread = ask - bid;

      if(type == POSITION_TYPE_BUY)
      {
         double risk = open - sl;
         if(risk <= 0) continue;                       // ya esta en BE
         if(bid >= open + BreakEvenAtR * risk)
            if(trade.PositionModify(tk, NormalizeDouble(open + spread, _Digits), tp))
               DoPartial(tk, vol);
      }
      else
      {
         double risk = sl - open;
         if(risk <= 0) continue;
         if(ask <= open - BreakEvenAtR * risk)
            if(trade.PositionModify(tk, NormalizeDouble(open - spread, _Digits), tp))
               DoPartial(tk, vol);
      }
   }
}

//========================== EVENTOS ===============================//
void OnTick()
{
   ManagePositions();
   if(!IsNewBar()) return;

   bool allow = CanTradeNow();
   CheckZones(allow);   // primero evaluar zonas existentes con la vela cerrada
   ScanForZones();      // luego buscar nuevas rupturas / OB
}