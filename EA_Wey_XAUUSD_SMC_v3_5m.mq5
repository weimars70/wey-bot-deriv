//+------------------------------------------------------------------+
//|                                      EA_Wey_Forex_SMC_M5.mq5     |
//|  Smart Money Concepts para Forex y metales                       |
//|                                                                   |
//|  Flujo de la estrategia:                                          |
//|   1) Sesgo HTF (estructura H1 o EMA): solo opera a favor.         |
//|   2) CHoCH/BOS: cierre que cambia o confirma la estructura, con  |
//|      desplazamiento (cuerpo grande vs ATR) y pierna minima.       |
//|   3) Order Block = ultima vela contraria antes del impulso.       |
//|      Confluencias: FVG en el impulso, barrido de liquidez en el   |
//|      origen, Premium/Discount.                                    |
//|   4) Entrada: el precio vuelve al OB y cierra con rechazo.        |
//|   5) SL tras el OB, TP por RR, parcial + BE a 1R.                 |
//|                                                                   |
//|  Recomendado: pares Forex o metales, grafico M5.                |
//+------------------------------------------------------------------+
#property copyright "Wey 2026"
#property version   "2.13"
#property description "SMC multi-simbolo: CHoCH/BOS + retroceso a Order Block + FVG/Sweep + Premium/Discount"

// Sin dependencias externas: no usa Trade.mqh, envia ordenes con OrderSend

//========================== INPUTS ================================//
input group "=== General ==="
input long             MagicNumber        = 880011;
input ENUM_TIMEFRAMES  HTF_Bias           = PERIOD_H1;      // TF del sesgo
input int              BiasMode           = 1;              // 0=Off, 1=Estructura HTF con respaldo EMA, 2=EMA HTF
input int              HTFSwingStrength   = 2;              // fractal HTF (velas a cada lado)
input int              EMAPeriod          = 100;            // solo si BiasMode = EMA

input group "=== Estructura / Order Block (TF del grafico) ==="
input int              SwingStrength      = 2;              // fractal (velas a cada lado)
input int              SwingLookback      = 120;             // velas hacia atras para buscar swings
input int              ATRPeriod          = 14;
input double           DisplacementATR    = 0.7;            // cuerpo minimo de la vela de impulso (x ATR)
input double           MinLegATR          = 1.0;            // tamano minimo del impulso (x ATR)
input int              OBZone             = 0;              // 0=rango completo, 1=solo cuerpo
input double           EntryDepthPct      = 50.0;           // profundidad en el OB (0=borde, 50=mitad)
input bool             RequireRejection   = true;           // exigir vela de rechazo al tocar
input int              ZoneMaxAgeBars     = 72;             // vida maxima de la zona (velas)
input int              MaxActiveZones     = 6;

input group "=== Confluencias SMC ==="
input bool             RequireFVG         = false;          // exigir FVG dentro del impulso
input bool             RequireSweep       = false;          // exigir barrido de liquidez en el origen
input int              SweepLookback      = 20;             // velas previas para el barrido
input bool             UsePremiumDiscount = true;           // comprar en descuento / vender en premium
input int              PDLookback         = 90;             // rango para calcular el equilibrio

input group "=== Riesgo ==="
input double           RiskPercent        = 0.5;            // % del balance por operacion y por simbolo
input double           MinLotRiskMult     = 4.0;            // si el lote minimo arriesga mas que RiskPercent, se permite hasta X veces ese riesgo (0 = siempre permitir)
input double           RR                 = 2.0;            // TP = RR x riesgo
input double           SLBufferATR        = 0.15;           // colchon del SL tras la zona (x ATR)
input double           MinSL_ATR          = 0.5;            // SL minimo (x ATR)
input double           MaxSL_ATR          = 3.0;            // SL maximo (x ATR)
input double           BreakEvenAtR       = 1.0;            // mover a BE al llegar a X R (0 = off)
input double           PartialClosePct    = 50.0;           // % que se cierra a BreakEvenAtR (0 = off)
input double           ProfitLockTriggerPct = 80.0;         // activar proteccion al alcanzar este % del TP (0 = off)
input double           ProfitLockPct      = 60.0;           // % del TP que protege el SL al activar la proteccion
input int              MaxOpenPositions   = 1;
input int              MaxTradesPerDay    = 3;
input double           DailyLossPercent   = 3.0;            // bloquea entradas si el dia pierde X% (0 = off)

input group "=== Filtros (horas = hora del SERVIDOR del broker) ==="
input bool             UseSession         = false;
input int              SessionStartHour   = 9;              // Londres aprox (broker GMT+2/+3)
input int              SessionEndHour     = 19;             // cierre del solape NY aprox
input int              FridayNoEntryHour  = 18;             // sin entradas viernes desde esta hora (0 = off)
input int              FridayCloseHour    = 0;              // cerrar todo viernes desde esta hora (0 = off)
input int              MaxSpreadPoints    = 60;             // spread maximo en puntos del simbolo (10 puntos = 1 pip en Forex de 5/3 digitos)
input double           MaxSpreadPctSL     = 15.0;           // spread maximo como % del SL
input int              DeviationPoints    = 30;             // desviacion maxima en puntos del simbolo

input group "=== Visual / Debug ==="
input bool             DrawObjects        = true;           // zonas activas del EA + flechas de entrada
input bool             ShowStructure      = true;           // BOS / CHoCH
input bool             ShowOB             = true;           // Order Blocks (los que cumplen desplazamiento)
input bool             ShowBrokenOB       = false;          // mostrar tambien OB ya invalidados
input bool             ShowFVG            = true;           // Fair Value Gaps sin rellenar
input double           FVGMinATR          = 0.15;           // tamano minimo del FVG (x ATR)
input bool             ShowSwings         = true;           // HH / HL / LH / LL / EQH / EQL
input bool             ShowPD             = true;           // linea de equilibrio premium/descuento
input bool             ShowPanel          = true;           // panel de estado en la esquina
input int              VisBars            = 250;            // velas hacia atras a analizar
input double           ZoneOpacity        = 0.28;           // opacidad de rellenos FVG (0.05 casi invisible, 0.4 fuerte)
input double           LineOpacity        = 0.90;           // opacidad de lineas, bordes y textos (0.3 a 1.0)
input double           ColorDim           = 0.80;           // oscurece todos los colores (1.0 = original, 0.7 = mas oscuro)
input bool             LogEachBar         = true;           // imprime un resumen en Expertos en cada vela nueva
input bool             Verbose            = false;          // detalle de por que se descarta cada zona/entrada

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
string   biasSource  = "estructura HTF";

//=========================== UTILS ================================//
// Ultimo motivo de descarte por direccion (0 = compra, 1 = venta). Se muestra en cada vela nueva.
string gWhy[2] = {"", ""};
int    gCurDir = 1;

void Log(const string s)
{
   gWhy[gCurDir > 0 ? 0 : 1] = s;
   if(Verbose) Print("[SMC] ", s);
}

// Oscurece un color multiplicando sus canales RGB por ColorDim.
color Dim(const color c)
{
   double k = MathMax(0.0, MathMin(1.0, ColorDim));
   uint f = (uint)c;
   int r = (int)((f & 0xFF) * k), g = (int)(((f >> 8) & 0xFF) * k), b = (int)(((f >> 16) & 0xFF) * k);
   return (color)(r | (g << 8) | (b << 16));
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
   if(SwingStrength < 1 || HTFSwingStrength < 1 || BiasMode < 0 || BiasMode > 2 || EMAPeriod < 1 ||
      RR <= 0 || RiskPercent <= 0 || MaxOpenPositions < 1 ||
      ProfitLockTriggerPct < 0 || ProfitLockTriggerPct > 100 || ProfitLockPct < 0 ||
      (ProfitLockTriggerPct > 0 && ProfitLockPct >= ProfitLockTriggerPct))
   {
      Print("Parametros invalidos");
      return INIT_PARAMETERS_INCORRECT;
   }

   atrHandle = iATR(_Symbol, _Period, ATRPeriod);
   if(atrHandle == INVALID_HANDLE) { Print("No se pudo crear ATR"); return INIT_FAILED; }

   if(BiasMode == 1 || BiasMode == 2)
   {
      emaHandle = iMA(_Symbol, HTF_Bias, EMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(emaHandle == INVALID_HANDLE) { Print("No se pudo crear EMA"); return INIT_FAILED; }
   }

   if(PeriodSeconds(HTF_Bias) <= PeriodSeconds(_Period))
      Print("AVISO: el TF del sesgo deberia ser mayor que el TF del grafico");

   ArrayResize(zones, 0);
   EventSetTimer(2);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(atrHandle != INVALID_HANDLE) IndicatorRelease(atrHandle);
   if(emaHandle != INVALID_HANDLE) IndicatorRelease(emaHandle);
   EventKillTimer();
   Comment("");
   ObjectsDeleteAll(0, "SMC_");
   ObjectsDeleteAll(0, "VIS_");
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
   biasSource = (BiasMode == 2) ? "EMA H1" : "estructura H1";

   if(BiasMode == 1)
   {
      const int n = 150;
      MqlRates h[];
      ArraySetAsSeries(h, true);
      if(CopyRates(_Symbol, HTF_Bias, 0, n, h) == n)
      {
         double H[], L[];
         ArrayResize(H, n); ArrayResize(L, n);
         for(int s = 0; s < n; s++) { H[s] = h[s].high; L[s] = h[s].low; }

         int hi[], lo[];
         FindSwings(H, L, n, HTFSwingStrength, 4, hi, lo);
         if(ArraySize(hi) >= 2 && ArraySize(lo) >= 2)
         {
            double c1 = h[1].close;
            bool bull = (L[lo[0]] > L[lo[1]]) && (H[hi[0]] > H[hi[1]] || c1 > H[hi[0]]) && c1 > L[lo[0]];
            bool bear = (H[hi[0]] < H[hi[1]]) && (L[lo[0]] < L[lo[1]] || c1 < L[lo[0]]) && c1 < H[hi[0]];
            if(bull && !bear)      biasDir = 1;
            else if(bear && !bull) biasDir = -1;
         }
      }
      if(biasDir != 0) return;
      biasSource = "EMA H1 (respaldo; estructura neutral)";
   }
   else if(BiasMode == 2)
   {
      biasSource = "EMA H1";
   }
   else return;

   double e[];
   ArraySetAsSeries(e, true);
   if(CopyBuffer(emaHandle, 0, 1, 4, e) != 4)
   {
      Print("[SMC] No se pudo leer EMA H1 para determinar el sesgo de ", _Symbol);
      return;
   }
   double c = iClose(_Symbol, HTF_Bias, 1);
   if(c <= 0)
   {
      Print("[SMC] No se pudo leer el cierre H1 para determinar el sesgo de ", _Symbol);
      return;
   }
   if(c > e[0] && e[0] > e[3])      biasDir = 1;
   else if(c < e[0] && e[0] < e[3]) biasDir = -1;
}

bool BiasAllows(const int dir)
{
   if(BiasMode == 0) return true;
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
   ObjectSetInteger(0, nm, OBJPROP_COLOR, Dim(z.dir > 0 ? clrSeaGreen : clrFireBrick));
   ObjectSetInteger(0, nm, OBJPROP_FILL, false);
   ObjectSetInteger(0, nm, OBJPROP_BACK, true);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, 2);
   ObjectSetString(0, nm, OBJPROP_TOOLTIP,
                   StringFormat("ZONA EA %s%s%s", z.dir > 0 ? "BUY" : "SELL", z.fvg ? " +FVG" : "", z.sweep ? " +SWEEP" : ""));

   // linea del nivel de entrada dentro de la zona
   double h   = z.top - z.bottom;
   double lvl = (z.dir > 0) ? z.top - h * EntryDepthPct / 100.0 : z.bottom + h * EntryDepthPct / 100.0;
   string ne  = nm + "_E";
   if(ObjectFind(0, ne) < 0)
      ObjectCreate(0, ne, OBJ_TREND, 0, z.t, lvl, t2, lvl);
   ObjectSetInteger(0, ne, OBJPROP_COLOR, Dim(clrGold));
   ObjectSetInteger(0, ne, OBJPROP_STYLE, STYLE_DOT);
   ObjectSetInteger(0, ne, OBJPROP_RAY_RIGHT, false);
}

void DrawBOS(const int dir, const datetime t1, const double price, const datetime t2)
{
   if(!DrawObjects) return;
   string nm = "SMC_BOS_" + IntegerToString((long)t2) + (dir > 0 ? "_B" : "_S");
   if(ObjectFind(0, nm) >= 0) return;
   color clr = Dim((dir > 0) ? clrDodgerBlue : clrTomato);
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
         ObjectSetInteger(0, nm, OBJPROP_COLOR, Dim(used ? clrGold : clrSilver));
         ObjectSetInteger(0, nm, OBJPROP_TIME, 1, TimeCurrent());
      }
      ObjectDelete(0, nm + "_E");
   }
   for(int k = idx; k < sz - 1; k++) zones[k] = zones[k+1];
   ArrayResize(zones, sz - 1);
}

//===================== DETECCION DE BOS + OB ======================//
bool BuildZone(const int dir, const int ih, const int breakBar, const double lvl, const MqlRates &r[],
               const double &O[], const double &H[], const double &L[], const double &C[],
               const int n, const double atr)
{
   // Origen del impulso: minimo mas bajo entre el swing roto y la vela de ruptura
   int org = -1;
   double minL = DBL_MAX;
   for(int s = breakBar + 1; s < ih; s++)
      if(L[s] < minL) { minL = L[s]; org = s; }
   if(org < breakBar + 1) { Log("sin pullback previo"); return false; }

   // Tamano del impulso
   if(C[breakBar] - L[org] < MinLegATR * atr) { Log("impulso pequeno"); return false; }

   // Desplazamiento: al menos una vela de cuerpo grande en el impulso
   double maxBody = 0;
   for(int s = breakBar; s < org; s++) maxBody = MathMax(maxBody, C[s] - O[s]);
   if(maxBody < DisplacementATR * atr) { Log("sin desplazamiento"); return false; }

   // Order Block: ultima vela contraria en/antes del origen (max 3 velas atras)
   int ob  = org;
   int lim = MathMin(org + 3, ih - 1);
   for(int s = org; s <= lim; s++)
      if(C[s] < O[s]) { ob = s; break; }

   double zTop = (OBZone == 0) ? H[ob] : MathMax(O[ob], C[ob]);
   double zBot = (OBZone == 0) ? L[ob] : MathMin(O[ob], C[ob]);
   double h    = zTop - zBot;
   if(h <= 0 || h > MaxSL_ATR * atr) { Log("OB demasiado grande"); return false; }

   double entry = zTop - h * EntryDepthPct / 100.0;

   // Un toque antes del quiebre invalida la zona; el retesteo posterior es la entrada.
   for(int s = breakBar + 1; s <= ob - 2; s++)
      if(L[s] <= entry) { Log("OB ya mitigado"); return false; }

   // No recuperar zonas cuyo precio ya cerró más allá del borde de invalidación.
   for(int s = breakBar - 1; s >= 1; s--)
      if(C[s] < zBot) { Log("OB invalidado despues del quiebre"); return false; }

   // Confluencia: FVG dentro del impulso
   bool fvg = false;
   for(int s = breakBar + 1; s <= org && s + 1 < n; s++)
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
      for(int s = breakBar; s < breakBar + PDLookback && s < n; s++)
      {
         pdH = MathMax(pdH, H[s]);
         pdL = MathMin(pdL, L[s]);
      }
      if(entry > (pdH + pdL) / 2.0) { Log("OB en zona premium/discount incorrecta"); return false; }
   }

   // Sesgo HTF
   if(!BiasAllows(dir)) { Log("contra sesgo HTF"); return false; }

   // Construir zona en precios reales
   SMCZone z;
   z.dir   = dir;
   z.t     = r[ob].time;
   z.age   = breakBar - 1;
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
   PrintFormat("[SMC] Nueva zona %s  %.2f - %.2f  FVG=%s SWEEP=%s",
               dir > 0 ? "BUY" : "SELL", z.bottom, z.top, fvg ? "si" : "no", swept ? "si" : "no");
   return true;
}

bool LatestStructureBreak(const MqlRates &r[], const int n, int &dir, int &ref,
                          int &breakBar, bool &choch)
{
   dir = 0;
   ref = -1;
   breakBar = -1;
   choch = false;
   double H[], L[];
   ArrayResize(H, n);
   ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }
   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, n, hi, lo);
   bool isH[], isL[];
   ArrayResize(isH, n);
   ArrayResize(isL, n);
   ArrayInitialize(isH, false);
   ArrayInitialize(isL, false);
   for(int k = 0; k < ArraySize(hi); k++) isH[hi[k]] = true;
   for(int k = 0; k < ArraySize(lo); k++) isL[lo[k]] = true;

   int trend = 0, hIdx = -1, lIdx = -1;
   int maxBars = MathMin(VisBars, n - SwingStrength - 1);
   for(int b = maxBars; b >= 1; b--)
   {
      int i = b + SwingStrength;
      if(i < n)
      {
         if(isH[i]) hIdx = i;
         if(isL[i]) lIdx = i;
      }
      if(hIdx > 0 && r[b].close > H[hIdx])
      {
         dir = 1;
         ref = hIdx;
         breakBar = b;
         choch = (trend == -1);
         trend = 1;
         hIdx = -1;
      }
      if(lIdx > 0 && r[b].close < L[lIdx])
      {
         dir = -1;
         ref = lIdx;
         breakBar = b;
         choch = (trend == 1);
         trend = -1;
         lIdx = -1;
      }
   }
   return (dir != 0 && ref > 0 && breakBar > 0);
}

bool DetectZone(const int dir, const MqlRates &r[], const int n, const double atr)
{
   int breakDir, ref, breakBar;
   bool choch;
   if(!LatestStructureBreak(r, n, breakDir, ref, breakBar, choch) || breakDir != dir)
   {
      Log("sin quiebre reciente de estructura en esta direccion");
      return false;
   }
   if(breakBar - 1 > ZoneMaxAgeBars)
   {
      Log("ultimo quiebre fuera de la vigencia de zonas");
      return false;
   }

   double O[], H[], L[], C[];
   BuildSeries(r, n, dir, O, H, L, C);
   if(ref > SwingLookback) { Log("quiebre fuera del lookback"); return false; }
   return BuildZone(dir, ref, breakBar, H[ref], r, O, H, L, C, n, atr);
}

void ScanForZones()
{
   double atr = GetATR(1);
   if(atr <= 0)
   {
      gWhy[0] = "ATR aun no disponible";
      gWhy[1] = "ATR aun no disponible";
      return;
   }

   int n = MathMax(SwingLookback, VisBars) + 2 * SwingStrength + SweepLookback + 10;
   if(PDLookback + 5 > n) n = PDLookback + 5;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n)
   {
      gWhy[0] = "historial insuficiente para analizar swings";
      gWhy[1] = "historial insuficiente para analizar swings";
      return;
   }

   gCurDir = +1; DetectZone(+1, r, n, atr);
   gCurDir = -1; DetectZone(-1, r, n, atr);
}

//===================== EJECUCION (sin CTrade) =====================//
int gLastRetcode = 0;

ENUM_ORDER_TYPE_FILLING GetFilling()
{
   long fm = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
   if((fm & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   if((fm & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

bool SendReq(MqlTradeRequest &req)
{
   MqlTradeResult res;
   ZeroMemory(res);
   bool sent = OrderSend(req, res);
   gLastRetcode = (int)res.retcode;
   if(!sent) return false;
   return (res.retcode == TRADE_RETCODE_DONE ||
           res.retcode == TRADE_RETCODE_DONE_PARTIAL ||
           res.retcode == TRADE_RETCODE_PLACED);
}

bool OpenMarket(const int dir, const double lots, const double sl, const double tp, const string cm)
{
   MqlTradeRequest req;
   ZeroMemory(req);
   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = _Symbol;
   req.volume       = lots;
   req.type         = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price        = SymbolInfoDouble(_Symbol, (dir > 0) ? SYMBOL_ASK : SYMBOL_BID);
   req.sl           = sl;
   req.tp           = tp;
   req.deviation    = (ulong)DeviationPoints;
   req.magic        = (ulong)MagicNumber;
   req.comment      = cm;
   req.type_filling = GetFilling();
   return SendReq(req);
}

bool ModifySLTP(const ulong tk, const double sl, const double tp)
{
   MqlTradeRequest req;
   ZeroMemory(req);
   req.action   = TRADE_ACTION_SLTP;
   req.position = tk;
   req.symbol   = _Symbol;
   req.sl       = sl;
   req.tp       = tp;
   req.magic    = (ulong)MagicNumber;
   return SendReq(req);
}

bool ClosePosition(const ulong tk, const double vol)
{
   if(!PositionSelectByTicket(tk)) return false;
   long ptype = PositionGetInteger(POSITION_TYPE);
   MqlTradeRequest req;
   ZeroMemory(req);
   req.action       = TRADE_ACTION_DEAL;
   req.position     = tk;
   req.symbol       = _Symbol;
   req.volume       = vol;
   req.type         = (ptype == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   req.price        = SymbolInfoDouble(_Symbol, (ptype == POSITION_TYPE_BUY) ? SYMBOL_BID : SYMBOL_ASK);
   req.deviation    = (ulong)DeviationPoints;
   req.magic        = (ulong)MagicNumber;
   req.type_filling = GetFilling();
   return SendReq(req);
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
      double minRisk = minL * lossPerLot;
      if(MinLotRiskMult > 0 && minRisk > riskMoney * MinLotRiskMult)
      {
         double bal = AccountInfoDouble(ACCOUNT_BALANCE);
         Log(StringFormat("lote minimo %.2f arriesga %.2f (%.2f%% del balance %.2f) y el limite es %.2f -> se omite. Sube RiskPercent o MinLotRiskMult",
                          minL, minRisk, bal > 0 ? minRisk / bal * 100.0 : 0.0, bal, riskMoney * MinLotRiskMult));
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
   bool ok = OpenMarket(z.dir, lots, sl, tp, cm);
   PrintFormat("[SMC] %s lots=%.2f entry=%.2f SL=%.2f TP=%.2f -> %s (%d)",
               z.dir > 0 ? "BUY" : "SELL", lots, entry, sl, tp,
               ok ? "OK" : "FALLO", gLastRetcode);
   if(ok && DrawObjects)
   {
      string an = "SMC_ENTRY_" + IntegerToString((long)TimeCurrent());
      if(ObjectCreate(0, an, (z.dir > 0) ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, TimeCurrent(), entry))
         ObjectSetInteger(0, an, OBJPROP_WIDTH, 3);
   }
   return ok;
}

// Se llama en cada vela nueva. Evalua toque + rechazo sobre la vela recien cerrada.
void CheckZones(const bool allowEntry, const bool newBar)
{
   int sz = ArraySize(zones);
   if(sz == 0) return;

   MqlRates b[];
   ArraySetAsSeries(b, true);
   if(CopyRates(_Symbol, _Period, 1, 1, b) != 1) return;
   double o1 = b[0].open, h1 = b[0].high, l1 = b[0].low, c1 = b[0].close;

   MqlTick tick;
   bool hasTick = SymbolInfoTick(_Symbol, tick);

   for(int i = sz - 1; i >= 0; i--)
   {
      if(newBar) zones[i].age++;

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
      bool tapped = (zones[i].dir > 0) ? ((l1 <= lvl) || (hasTick && tick.bid <= lvl))
                                       : ((h1 >= lvl) || (hasTick && tick.ask >= lvl));
      if(!tapped) continue;

      if(RequireRejection)
      {
         bool rej = false;
         if(zones[i].dir > 0)
         {
            rej = (c1 > lvl && c1 > o1) || (hasTick && tick.bid > lvl);
         }
         else
         {
            rej = (c1 < lvl && c1 < o1) || (hasTick && tick.ask < lvl);
         }
         if(!rej) { gCurDir = zones[i].dir; Log("zona tocada pero sin vela de rechazo"); continue; }
      }

      gCurDir = zones[i].dir;
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
   ClosePosition(tk, cv);
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
         if(d.day_of_week == 5 && d.hour >= FridayCloseHour) { ClosePosition(tk, PositionGetDouble(POSITION_VOLUME)); continue; }
      }

      if(BreakEvenAtR <= 0 && ProfitLockTriggerPct <= 0) continue;

      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      if(sl <= 0) continue;

      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double spread = ask - bid;
      double risk = 0;
      double desiredSL = sl;
      bool partialDue = false;

      if(type == POSITION_TYPE_BUY)
      {
         risk = open - sl;
         if(risk <= 0 && tp > open && RR > 0) risk = (tp - open) / RR;
         if(risk > 0 && BreakEvenAtR > 0 && bid >= open + BreakEvenAtR * risk)
         {
            double beSL = open + spread;
            partialDue = sl < beSL;
            desiredSL = MathMax(desiredSL, beSL);
         }
         if(ProfitLockTriggerPct > 0 && tp > open &&
            bid >= open + (tp - open) * ProfitLockTriggerPct / 100.0)
            desiredSL = MathMax(desiredSL, open + (tp - open) * ProfitLockPct / 100.0);
      }
      else
      {
         risk = sl - open;
         if(risk <= 0 && tp < open && RR > 0) risk = (open - tp) / RR;
         if(risk > 0 && BreakEvenAtR > 0 && ask <= open - BreakEvenAtR * risk)
         {
            double beSL = open - spread;
            partialDue = sl > beSL;
            desiredSL = MathMin(desiredSL, beSL);
         }
         if(ProfitLockTriggerPct > 0 && tp < open &&
            ask <= open - (open - tp) * ProfitLockTriggerPct / 100.0)
            desiredSL = MathMin(desiredSL, open - (open - tp) * ProfitLockPct / 100.0);
      }

      bool improved = (type == POSITION_TYPE_BUY) ? desiredSL > sl : desiredSL < sl;
      if(improved && ModifySLTP(tk, NormalizeDouble(desiredSL, _Digits), tp) && partialDue)
         DoPartial(tk, vol);
   }
}

//=================== VISUALIZACION (solo dibujo) ==================//
// Todo lo que empieza con "VIS_" es solo de guia, no afecta las operaciones.
int  visId    = 0;
bool visReady = false;

// Mezcla un color con el fondo del grafico (simula transparencia).
// a = 0 -> igual al fondo (invisible), a = 1 -> color puro.
color Blend(const color fg, const double alpha)
{
   double a = MathMax(0.0, MathMin(1.0, alpha));
   uint bg = (uint)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   uint f  = (uint)Dim(fg);
   int br = (int)(bg & 0xFF), bgn = (int)((bg >> 8) & 0xFF), bb = (int)((bg >> 16) & 0xFF);
   int fr = (int)(f & 0xFF),  fgn = (int)((f >> 8) & 0xFF),  fb = (int)((f >> 16) & 0xFF);
   int rr = (int)(br  + (fr  - br)  * a);
   int gg = (int)(bgn + (fgn - bgn) * a);
   int bl = (int)(bb  + (fb  - bb)  * a);
   return (color)(rr | (gg << 8) | (bl << 16));
}

string VName(const string tag)
{
   visId++;
   return "VIS_" + tag + "_" + IntegerToString(visId);
}

void VLine(const datetime t1, const double p1, const datetime t2, const double p2,
           const color c, const int width, const ENUM_LINE_STYLE style)
{
   string nm = VName("L");
   if(!ObjectCreate(0, nm, OBJ_TREND, 0, t1, p1, t2, p2)) return;
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, style);
   ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
}

void VText(const datetime t, const double p, const string txt, const color c,
           const int size, const ENUM_ANCHOR_POINT anc)
{
   string nm = VName("T");
   if(!ObjectCreate(0, nm, OBJ_TEXT, 0, t, p)) return;
   ObjectSetString(0, nm, OBJPROP_TEXT, txt);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, size);
   ObjectSetInteger(0, nm, OBJPROP_ANCHOR, anc);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
}

void VRect(const datetime t1, const double top, const datetime t2, const double bot,
           const color c, const bool fill, const ENUM_LINE_STYLE style, const int width)
{
   string nm = VName("R");
   if(!ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, top, t2, bot)) return;
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetInteger(0, nm, OBJPROP_FILL, fill);
   ObjectSetInteger(0, nm, OBJPROP_BACK, true);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, style);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
}

// Dibuja un BOS/CHoCH y su Order Block. Arrays O/H/L/C ya vienen "espejados" segun dir.
void VisBreak(const int dir, const int ref, const int b, const bool choch,
              const MqlRates &r[], const int n, const double atr,
              const double &O[], const double &H[], const double &L[], const double &C[])
{
   double   lvl  = (dir > 0) ? H[ref] : -H[ref];
   datetime t1   = r[ref].time;
   datetime t2   = r[b].time;
   datetime tFut = r[0].time + (datetime)(PeriodSeconds(_Period) * 8);

   if(ShowStructure)
   {
      color c = Blend(choch ? clrOrange : (dir > 0 ? clrDodgerBlue : clrTomato), MathMin(1.0, LineOpacity + (choch ? 0.2 : 0.0)));
      VLine(t1, lvl, t2, lvl, c, choch ? 2 : 1, STYLE_SOLID);
      datetime tm = (datetime)(((long)t1 + (long)t2) / 2);
      VText(tm, lvl, choch ? "CHoCH" : "BOS", c, 8, (dir > 0) ? ANCHOR_LOWER : ANCHOR_UPPER);
   }
   if(!ShowOB) return;

   // Origen del impulso
   int org = -1;
   double minL = DBL_MAX;
   for(int s = b + 1; s < ref; s++)
      if(L[s] < minL) { minL = L[s]; org = s; }
   if(org < 0) return;
   if(C[b] - L[org] < MinLegATR * atr) return;

   double maxBody = 0;
   for(int s = b; s < org; s++) maxBody = MathMax(maxBody, C[s] - O[s]);
   if(maxBody < DisplacementATR * atr) return;

   // Vela del OB
   int ob  = org;
   int lim = MathMin(org + 3, ref - 1);
   for(int s = org; s <= lim; s++)
      if(C[s] < O[s]) { ob = s; break; }

   double zTop = (OBZone == 0) ? H[ob] : MathMax(O[ob], C[ob]);
   double zBot = (OBZone == 0) ? L[ob] : MathMin(O[ob], C[ob]);
   if(zTop - zBot <= 0) return;

   // Estado: tocado / invalidado
   bool mitig = false, broken = false;
   datetime tEnd = tFut;
   for(int s = b - 1; s >= 1; s--)
   {
      if(L[s] <= zTop) mitig = true;
      if(C[s] < zBot) { broken = true; tEnd = r[s].time; break; }
   }
   if(broken && !ShowBrokenOB) return;

   // FVG dentro del impulso
   bool fvg = false;
   for(int s = b + 1; s <= org && s + 1 < n; s++)
      if(L[s-1] > H[s+1]) { fvg = true; break; }

   double top = (dir > 0) ? zTop : -zBot;
   double bot = (dir > 0) ? zBot : -zTop;
   color  oc  = Blend(broken ? clrSilver : (dir > 0 ? clrMediumSeaGreen : clrIndianRed), LineOpacity);
   VRect(r[ob].time, top, tEnd, bot, oc, false, mitig ? STYLE_DOT : STYLE_SOLID, 1);
   string tx = "OB " + (dir > 0 ? "compra" : "venta") + (fvg ? " +FVG" : "") + (mitig ? " (tocado)" : "");
   VText(r[ob].time, top, tx, oc, 8, ANCHOR_LEFT_LOWER);
}

bool UpdateVisuals()
{
   if(!(ShowStructure || ShowOB || ShowFVG || ShowSwings || ShowPD)) return true;
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE)) return true;

   int st = SwingStrength;
   int n  = VisBars + 2 * st + SweepLookback + 10;
   if(PDLookback + 5 > n) n = PDLookback + 5;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) return false;

   // ATR propio (no depende del handle del indicador)
   double atr = 0;
   int ac = 0;
   for(int s = 1; s <= ATRPeriod && s + 1 < n; s++)
   {
      atr += MathMax(r[s].high, r[s+1].close) - MathMin(r[s].low, r[s+1].close);
      ac++;
   }
   if(ac == 0) return false;
   atr /= ac;
   if(atr <= 0) return false;

   ObjectsDeleteAll(0, "VIS_");
   visId = 0;

   double O[], H[], L[], C[];
   double Od[], Hd[], Ld[], Cd[];
   BuildSeries(r, n, +1, O, H, L, C);
   BuildSeries(r, n, -1, Od, Hd, Ld, Cd);

   int hi[], lo[];
   FindSwings(H, L, n, st, n, hi, lo);
   bool isH[], isL[];
   ArrayResize(isH, n); ArrayResize(isL, n);
   ArrayInitialize(isH, false); ArrayInitialize(isL, false);
   for(int k = 0; k < ArraySize(hi); k++) if(hi[k] <= VisBars) isH[hi[k]] = true;
   for(int k = 0; k < ArraySize(lo); k++) if(lo[k] <= VisBars) isL[lo[k]] = true;

   datetime tFut = r[0].time + (datetime)(PeriodSeconds(_Period) * 8);

   // --- Swings: HH / LH / HL / LL / EQH / EQL ---
   if(ShowSwings)
   {
      double pH = 0, pL = 0;
      bool hasH = false, hasL = false;
      for(int i = VisBars; i >= st + 1; i--)
      {
         if(isH[i])
         {
            string tx = "H";
            if(hasH) tx = (MathAbs(H[i] - pH) < 0.1 * atr) ? "EQH" : ((H[i] > pH) ? "HH" : "LH");
            VText(r[i].time, H[i], tx, Blend(clrGray, LineOpacity), 7, ANCHOR_LOWER);
            pH = H[i]; hasH = true;
         }
         if(isL[i])
         {
            string tx = "L";
            if(hasL) tx = (MathAbs(L[i] - pL) < 0.1 * atr) ? "EQL" : ((L[i] > pL) ? "HL" : "LL");
            VText(r[i].time, L[i], tx, Blend(clrGray, LineOpacity), 7, ANCHOR_UPPER);
            pL = L[i]; hasL = true;
         }
      }
   }

   // --- Estructura: BOS / CHoCH + Order Blocks ---
   if(ShowStructure || ShowOB)
   {
      int trend = 0;
      int hIdx = -1, lIdx = -1;
      for(int b = VisBars; b >= 1; b--)
      {
         int i = b + st;
         if(i < n)
         {
            if(isH[i]) hIdx = i;
            if(isL[i]) lIdx = i;
         }
         if(hIdx > 0 && C[b] > H[hIdx])
         {
            VisBreak(+1, hIdx, b, (trend == -1), r, n, atr, O, H, L, C);
            trend = 1;
            hIdx = -1;
         }
         if(lIdx > 0 && C[b] < L[lIdx])
         {
            VisBreak(-1, lIdx, b, (trend == 1), r, n, atr, Od, Hd, Ld, Cd);
            trend = -1;
            lIdx = -1;
         }
      }
   }

   // --- FVG sin rellenar ---
   if(ShowFVG)
   {
      double minGap = FVGMinATR * atr;
      for(int s = VisBars; s >= 2; s--)
      {
         if(L[s-1] > H[s+1] && (L[s-1] - H[s+1]) >= minGap)
         {
            double gb = H[s+1], gt = L[s-1];
            bool filled = false;
            for(int t = s - 2; t >= 1; t--) if(L[t] <= gb) { filled = true; break; }
            if(!filled)
            {
               VRect(r[s+1].time, gt, tFut, gb, Blend(clrDeepSkyBlue, ZoneOpacity), true, STYLE_SOLID, 1);
               VText(r[s+1].time, gt, "FVG+", Blend(clrDeepSkyBlue, LineOpacity), 7, ANCHOR_LEFT_LOWER);
            }
         }
         if(H[s-1] < L[s+1] && (L[s+1] - H[s-1]) >= minGap)
         {
            double gb = H[s-1], gt = L[s+1];
            bool filled = false;
            for(int t = s - 2; t >= 1; t--) if(H[t] >= gt) { filled = true; break; }
            if(!filled)
            {
               VRect(r[s+1].time, gt, tFut, gb, Blend(clrCrimson, ZoneOpacity), true, STYLE_SOLID, 1);
               VText(r[s+1].time, gt, "FVG-", Blend(clrCrimson, LineOpacity), 7, ANCHOR_LEFT_LOWER);
            }
         }
      }
   }

   // --- Equilibrio (premium / descuento) ---
   if(ShowPD)
   {
      double hh = -DBL_MAX, ll = DBL_MAX;
      int pdn = MathMin(PDLookback, n - 1);
      for(int s = 1; s <= pdn; s++) { hh = MathMax(hh, H[s]); ll = MathMin(ll, L[s]); }
      double eq = (hh + ll) / 2.0;
      VLine(r[pdn].time, eq, tFut, eq, Blend(clrGray, LineOpacity), 1, STYLE_DASH);
      VText(tFut, eq, "EQ (arriba premium / abajo descuento)", Blend(clrGray, LineOpacity), 7, ANCHOR_LEFT_LOWER);
   }

   ChartRedraw(0);
   return true;
}

void UpdatePanel()
{
   if(!ShowPanel) return;
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE)) return;
   if(BiasMode != 0) UpdateBias();

   string bias = "OFF";
   if(BiasMode != 0)
      bias = (biasDir > 0) ? "ALCISTA (solo compras)" : ((biasDir < 0) ? "BAJISTA (solo ventas)" : "NEUTRAL (no opera)");

   double closed; int entries;
   DayStats(closed, entries);

   string s = "EA Wey SMC " + _Symbol + " v2.13 (CHoCH/BOS)\n";
   s += "Sesgo " + EnumToString(HTF_Bias) + ": " + bias + " [" + biasSource + "]\n";
   s += "Sesion: " + (InSession() ? "ACTIVA" : "FUERA") + "  (hora servidor " + TimeToString(TimeCurrent(), TIME_MINUTES) + ")\n";
   s += "Spread: " + IntegerToString((int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD)) + " pts (max " + IntegerToString(MaxSpreadPoints) + ")\n";
   s += "Zonas activas del EA: " + IntegerToString(ArraySize(zones)) + "\n";
   s += "Operaciones hoy: " + IntegerToString(entries) + "/" + IntegerToString(MaxTradesPerDay) + "   PnL cerrado: " + DoubleToString(closed, 2);
   Comment(s);
}

//========================== EVENTOS ===============================//
void OnTimer()
{
   if(!visReady) visReady = UpdateVisuals();
   UpdatePanel();
}

void OnTick()
{
   ManagePositions();
   if(!visReady) visReady = UpdateVisuals();

   bool newBar = IsNewBar();
   if(newBar) { gWhy[0] = ""; gWhy[1] = ""; }

   bool allow = CanTradeNow();
   if(ArraySize(zones) > 0)
      CheckZones(allow, newBar);

   if(!newBar) return;

   ScanForZones();      // luego buscar nuevas rupturas / OB
   if(LogEachBar)
      PrintFormat("[SMC] Vela nueva %s %s | servidor %s | sesion=%s | spread=%d | sesgo=%d | zonas=%d | operar=%s | COMPRA: %s | VENTA: %s",
                  _Symbol, EnumToString(_Period), TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES),
                  InSession() ? "SI" : "NO",
                  (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), biasDir, ArraySize(zones), allow ? "SI" : "NO",
                  gWhy[0] == "" ? "-" : gWhy[0], gWhy[1] == "" ? "-" : gWhy[1]);
   UpdateVisuals();     // redibujar estructura, OB y FVG
   UpdatePanel();
}
