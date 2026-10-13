//+------------------------------------------------------------------+
//|                                            Wey_Trading_Bot.mq5   |
//|                     Conversion MQ4 -> MQ5 + mejoras (v2.00)      |
//|                                                     2026, Wey    |
//+------------------------------------------------------------------+
//| Cambios principales respecto a la version MQ4:                    |
//|  - El TP en "pips" (_Point*10) cerraba con ~1 USD en sinteticos.  |
//|    Ahora todas las distancias se adaptan al simbolo via ATR.      |
//|  - Profit Lock: al llegar a X USD asegura el Y% del pico maximo   |
//|    (por defecto: tras 5 USD asegura siempre el 70%).              |
//|  - Maximo de operaciones concurrentes estricto (por defecto 2).   |
//|  - Filtro de tendencia en TF superior + ADX para evitar rangos.   |
//|  - Filtro de noticias con el calendario economico nativo de MT5.  |
//|  - Sin DLLs, sin variables globales ofuscadas, codigo legible.    |
//+------------------------------------------------------------------+
#property copyright   "2026, Wey"
#property version     "2.00"
#property description "Wey Trading Bot v2 (MT5)"
#property description "Senal MA + HILO, filtro de tendencia TF superior y ADX."
#property description "Distancias auto-adaptadas por ATR y Profit Lock (asegura % del pico)."

#include <Trade\Trade.mqh>

//+------------------------------------------------------------------+
//| Enumeraciones                                                     |
//+------------------------------------------------------------------+
enum ENUM_LOT_MODE
  {
   LOT_FIXED          = 0, // Lote fijo
   LOT_PERCENT_MARGIN = 1, // % del balance como margen
   LOT_RISK_PERCENT   = 2  // % de riesgo segun SL
  };

enum ENUM_GRID_LOT
  {
   GRID_FIXED      = 0, // Fijo      0.01 / 0.01 / 0.01
   GRID_SUM        = 1, // Suma      0.01 / 0.02 / 0.03
   GRID_MARTINGALE = 2, // Martingala lote * factor^n
   GRID_STEP       = 3  // Escalon   0.01 / 0.01 / 0.02 ...
  };

enum ENUM_SL_MODE
  {
   SL_NONE   = 0, // Sin SL
   SL_ATR    = 1, // SL = ATR x multiplicador
   SL_POINTS = 2  // SL en puntos
  };

enum ENUM_TP_MODE
  {
   TP_NONE   = 0, // Sin TP (deja correr, sale con Profit Lock)
   TP_ATR    = 1, // TP = ATR x multiplicador
   TP_POINTS = 2, // TP en puntos
   TP_MONEY  = 3  // TP de canasta en dinero
  };

enum ENUM_GRID_STEP_MODE
  {
   STEP_ATR    = 0, // Paso = ATR x multiplicador
   STEP_POINTS = 1  // Paso en puntos
  };

enum ENUM_LOCK_MODE
  {
   LOCK_POSITION = 0, // Por posicion (cada una independiente)
   LOCK_BASKET   = 1  // Por canasta (1 pos = posicion, 2+ = canasta)
  };

enum ENUM_CLOSE_SCOPE
  {
   CLOSE_ALL_ACCOUNT = 0, // Todas las posiciones de la cuenta
   CLOSE_SYMBOL      = 1, // Todas las de este simbolo
   CLOSE_EA          = 2  // Solo las del EA en este simbolo
  };

enum ENUM_LIMIT_MODE
  {
   LIMIT_MONEY   = 0, // Dinero
   LIMIT_PERCENT = 1  // Porcentaje del equity inicial del dia
  };

//+------------------------------------------------------------------+
//| Parametros                                                        |
//+------------------------------------------------------------------+
input group "=== General ==="
input bool            InpOpenNewOrders       = true;        // Abrir nuevas operaciones
input bool            InpEnableEngineA       = true;        // Motor A [BUY]
input long            InpMagicA              = 66778899;    // Magic Motor A
input bool            InpEnableEngineB       = true;        // Motor B [SELL]
input long            InpMagicB              = 9977;        // Magic Motor B
input int             InpMaxTrades           = 2;           // Max operaciones concurrentes (0 = sin limite)
input bool            InpMaxTradesAllSymbols = false;       // Contar max operaciones en todos los simbolos
input double          InpMaxTotalLots        = 0;           // Max lotes totales del EA (0 = sin limite)
input int             InpSignalIntervalMin   = 15;          // Minutos entre evaluaciones de senal
input bool            InpOneOrderPerCandle   = true;        // Max una orden por vela
input ENUM_TIMEFRAMES InpCandleTF            = PERIOD_CURRENT; // TF para "una orden por vela"
input int             InpSlippagePoints      = 50;          // Deslizamiento maximo (puntos)
input string          InpOrderComment        = "WeyBot v2"; // Comentario de las ordenes

input group "=== Lote ==="
input ENUM_LOT_MODE   InpLotMode             = LOT_FIXED;   // Modo de lote
input double          InpFixedLot            = 0.01;        // Lote fijo (se ajusta al minimo del simbolo)
input double          InpPercentMargin       = 1.0;         // % del balance usado como margen
input double          InpRiskPercent         = 1.0;         // % del balance arriesgado (requiere SL)
input double          InpMaxLot              = 99;          // Lote maximo por orden

input group "=== Senal: Media movil ==="
input ENUM_TIMEFRAMES InpMaTF                = PERIOD_CURRENT; // TF de la media
input int             InpMaPeriod            = 34;          // Periodo
input ENUM_MA_METHOD  InpMaMethod            = MODE_EMA;    // Metodo
input ENUM_APPLIED_PRICE InpMaPrice          = PRICE_OPEN;  // Precio
input int             InpMaShift             = 0;           // Desplazamiento (barras)
input bool            InpUseClosedBar        = true;        // Usar vela cerrada (evita senales que repintan)

input group "=== Senal: HILO ==="
input bool            InpUseHILO             = true;        // Usar HILO
input bool            InpHILOInvert          = false;       // Invertir HILO
input ENUM_TIMEFRAMES InpHILOTF              = PERIOD_CURRENT; // TF HILO
input int             InpHILOPeriod          = 3;           // Periodo HILO
input ENUM_MA_METHOD  InpHILOMethod          = MODE_EMA;    // Metodo HILO
input int             InpHILOShift           = 0;           // Desplazamiento HILO

input group "=== Filtro de tendencia (TF superior) ==="
input bool            InpUseTrendFilter      = true;        // Usar filtro de tendencia
input ENUM_TIMEFRAMES InpTrendTF             = PERIOD_H1;   // TF de tendencia
input int             InpTrendMaPeriod       = 200;         // Periodo de la media de tendencia
input ENUM_MA_METHOD  InpTrendMaMethod       = MODE_EMA;    // Metodo
input bool            InpTrendRequireSlope   = true;        // Exigir pendiente a favor
input int             InpTrendSlopeBars      = 3;           // Barras para medir la pendiente
input bool            InpGridRespectTrend    = true;        // Grid solo si la tendencia sigue a favor

input group "=== Filtro ADX (evitar rangos) ==="
input bool            InpUseADX              = true;        // Usar ADX
input ENUM_TIMEFRAMES InpADXTF               = PERIOD_CURRENT; // TF ADX
input int             InpADXPeriod           = 14;          // Periodo ADX
input double          InpADXMin              = 20.0;        // ADX minimo para operar
input bool            InpADXUseDI            = true;        // +DI / -DI deben confirmar la direccion

input group "=== Volatilidad (ATR) - auto adaptacion al simbolo ==="
input ENUM_TIMEFRAMES InpATRTF               = PERIOD_CURRENT; // TF ATR
input int             InpATRPeriod           = 14;          // Periodo ATR

input group "=== Stop Loss / Take Profit ==="
input ENUM_SL_MODE    InpSLMode              = SL_ATR;      // Modo de SL
input double          InpSLATRMult           = 3.0;         // SL = ATR x
input int             InpSLPoints            = 0;           // SL en puntos
input ENUM_TP_MODE    InpTPMode              = TP_NONE;     // Modo de TP
input double          InpTPATRMult           = 6.0;         // TP = ATR x
input int             InpTPPoints            = 0;           // TP en puntos
input double          InpTPMoney             = 0;           // TP de canasta en dinero
input double          InpMaxLossPerTrade     = 8.0;         // Perdida maxima por operacion en dinero (0 = off)

input group "=== Profit Lock (asegurar ganancias) ==="
input bool            InpUseProfitLock       = true;        // Usar Profit Lock
input double          InpLockStartMoney      = 5.0;         // Activar al llegar a X en ganancia
input double          InpLockPercent         = 70.0;        // % del pico maximo que se asegura
input ENUM_LOCK_MODE  InpLockMode            = LOCK_BASKET; // Modo de Profit Lock
input bool            InpLockMoveSL          = true;        // Mover el SL al nivel asegurado (protege sin conexion)

input group "=== Trailing / Break-even por ATR (opcional) ==="
input bool            InpUseATRTrailing      = false;       // Trailing por ATR
input double          InpTrailStartATR       = 1.5;         // Iniciar trailing a ATR x
input double          InpTrailDistATR        = 1.0;         // Distancia del trailing ATR x
input bool            InpUseBreakEven        = false;       // Break-even
input double          InpBEStartATR          = 1.0;         // Activar break-even a ATR x
input double          InpBEOffsetATR         = 0.1;         // Asegurar ATR x por encima de la entrada

input group "=== Grid ==="
input bool            InpEnableGrid          = true;        // Habilitar grid
input ENUM_GRID_LOT   InpGridLotType         = GRID_MARTINGALE; // Tipo de lote del grid
input ENUM_GRID_STEP_MODE InpGridStepMode    = STEP_ATR;    // Modo de paso
input double          InpGridStepATR         = 1.5;         // Paso = ATR x
input int             InpGridStepPoints      = 1000;        // Paso en puntos
input double          InpGridFactor          = 1.457;       // Factor martingala
input int             InpGridStepLot         = 4;           // Cada cuantos niveles sube el lote (Escalon)
input int             InpMaxGridLevels       = 2;           // Max niveles por motor (incluye la primera)

input group "=== Spread ==="
input int             InpMaxSpreadPoints     = 0;           // Spread maximo en puntos (0 = off)
input double          InpMaxSpreadATRPct     = 25.0;        // Spread maximo como % del ATR (0 = off)

input group "=== Proteccion de equity ==="
input ENUM_CLOSE_SCOPE InpProtectScope       = CLOSE_EA;    // Alcance de medicion y cierre
input double          InpMaxFloatingDDMoney  = 0;           // Max DD flotante en dinero (0 = off)
input double          InpMaxFloatingDDPct    = 0;           // Max DD flotante en % del balance (0 = off)
input double          InpMaxFloatingProfitMoney = 0;        // Cerrar todo al flotante + dinero (0 = off)
input double          InpMaxFloatingProfitPct   = 0;        // Cerrar todo al flotante + % (0 = off)
input double          InpEquitySL            = 0;           // Equity minimo -> detener EA (0 = off)
input double          InpEquityTP            = 0;           // Equity maximo -> detener EA (0 = off)
input ENUM_LIMIT_MODE InpDailyMode           = LIMIT_MONEY; // Modo de limites diarios
input double          InpMaxDailyDD          = 20.0;        // Perdida diaria maxima (0 = off)
input double          InpDailyTarget         = 100.0;       // Objetivo diario (0 = off)
input bool            InpRemoveEAOnStop      = false;       // Quitar el EA del grafico al detenerse

input group "=== Noticias (calendario economico de MT5) ==="
input bool            InpUseNews             = false;       // Usar filtro de noticias
input bool            InpNewsHigh            = true;        // Impacto alto
input bool            InpNewsMedium          = false;       // Impacto medio
input bool            InpNewsLow             = false;       // Impacto bajo
input int             InpNewsBeforeMin       = 60;          // Minutos antes del evento
input int             InpNewsAfterMin        = 60;          // Minutos despues del evento
input string          InpNewsCurrencies      = "";          // Monedas (ej "USD,EUR"). Vacio = las del simbolo
input bool            InpNewsCloseTrades     = false;       // Cerrar operaciones del EA al empezar la noticia

input group "=== Horario (HH:MM-HH:MM,HH:MM-HH:MM | vacio = todo el dia | OFF = no operar) ==="
input bool            InpUseTimeFilter       = false;       // Usar horario
input string          InpMonday              = "";          // Lunes
input string          InpTuesday             = "";          // Martes
input string          InpWednesday           = "";          // Miercoles
input string          InpThursday            = "";          // Jueves
input string          InpFriday              = "";          // Viernes
input string          InpSaturday            = "";          // Sabado
input string          InpSunday              = "";          // Domingo
input bool            InpCloseOutsideHours   = true;        // Cerrar operaciones del EA al salir del horario

input group "=== Panel ==="
input bool            InpShowPanel           = true;        // Mostrar panel
input int             InpPanelX              = 10;          // Posicion X
input int             InpPanelY              = 25;          // Posicion Y

//+------------------------------------------------------------------+
//| Tipos y variables globales                                        |
//+------------------------------------------------------------------+
struct SBasket
  {
   int               count;
   double            lots;
   double            avgPrice;
   double            profit;
   double            lastPrice;
   double            lastLot;
   long              lastTimeMsc;
   double            firstSL;
   long              firstTimeMsc;
  };

CTrade   trade;

int      hMA     = INVALID_HANDLE;
int      hHiloH  = INVALID_HANDLE;
int      hHiloL  = INVALID_HANDLE;
int      hTrend  = INVALID_HANDLE;
int      hADX    = INVALID_HANDLE;
int      hATR    = INVALID_HANDLE;

SBasket  g_b[2];
double   g_atr            = 0;
int      g_signal         = 0;
string   g_sigTxt         = "";
long     g_signalSlot     = -1;
long     g_entrySlot[2]   = {-1, -1};
datetime g_lastBar[2]     = {0, 0};
double   g_basketPeak[2]  = {0, 0};
double   g_lockPeak[2]    = {0, 0};
double   g_lockLevel[2]   = {0, 0};

int      g_dayKey         = 0;
double   g_dayBaseline    = 0;
double   g_dayMin         = 0;
double   g_dayMax         = 0;
bool     g_dayLocked      = false;
bool     g_hardStop       = false;
bool     g_paused         = false;
bool     g_wasInHours     = true;
bool     g_wasNews        = false;
string   g_block          = "";
string   g_gvPrefix       = "";

double   g_maxFloatDD     = 0;
double   g_minEquity      = 0;
double   g_todayRealized  = 0;
int      g_todayClosed    = 0;

datetime g_newsTimes[];
string   g_newsNames[];
datetime g_newsLoaded     = 0;

#define OBJ_PREFIX   "WEY_"
#define PEAK_PREFIX  "WEYPK_"

// Colores del panel
#define CLR_BG     C'16,20,30'
#define CLR_BORDER C'52,62,84'
#define CLR_TITLE  C'255,196,64'
#define CLR_TEXT   C'215,222,235'
#define CLR_MUTED  C'130,142,165'
#define CLR_GREEN  C'38,201,135'
#define CLR_RED    C'235,87,87'
#define CLR_AMBER  C'245,166,35'
#define CLR_BTN    C'40,48,66'

//+------------------------------------------------------------------+
//| Utilidades basicas                                                |
//+------------------------------------------------------------------+
bool   IsOurMagic(const long m)  { return (m == InpMagicA || m == InpMagicB); }
long   EngineMagic(const int e)  { return (e == 0 ? InpMagicA : InpMagicB); }
int    EngineDir(const int e)    { return (e == 0 ? 1 : -1); }
bool   EngineEnabled(const int e){ return (e == 0 ? InpEnableEngineA : InpEnableEngineB); }
double Bid()                     { return SymbolInfoDouble(_Symbol, SYMBOL_BID); }
double Ask()                     { return SymbolInfoDouble(_Symbol, SYMBOL_ASK); }
bool   IsTester()                { return (bool)MQLInfoInteger(MQL_TESTER); }

string DirTxt(const int d)       { return (d > 0 ? "UP" : (d < 0 ? "DN" : "--")); }
string SigName(const int d)      { return (d > 0 ? "COMPRA" : (d < 0 ? "VENTA" : "NEUTRAL")); }

double Buf(const int handle, const int buffer, const int shift)
  {
   if(handle == INVALID_HANDLE)
      return EMPTY_VALUE;
   double v[1];
   if(CopyBuffer(handle, buffer, shift, 1, v) != 1)
      return EMPTY_VALUE;
   return v[0];
  }

double NormalizePrice(const double price)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double p  = price;
   if(ts > 0)
      p = MathRound(p / ts) * ts;
   return NormalizeDouble(p, _Digits);
  }

int VolumeDigits(const double step)
  {
   if(step <= 0 || step >= 1)
      return 0;
   return (int)MathMax(0, MathCeil(-MathLog10(step) - 1e-9));
  }

double NormalizeLot(double lot)
  {
   double mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double st = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(st <= 0)
      st = mn;
   if(InpMaxLot > 0 && lot > InpMaxLot)
      lot = InpMaxLot;
   lot = MathFloor(lot / st + 1e-7) * st;
   if(lot < mn)
      lot = mn;
   if(lot > mx)
      lot = mx;
   return NormalizeDouble(lot, VolumeDigits(st));
  }

double MinStopDistance()
  {
   long stops  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freeze = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   return (double)(MathMax(stops, freeze) + 2) * _Point;
  }

//+------------------------------------------------------------------+
//| Distancias auto adaptadas                                         |
//+------------------------------------------------------------------+
double SLDistance()
  {
   if(InpSLMode == SL_ATR)
      return (g_atr > 0 ? g_atr * InpSLATRMult : 0);
   if(InpSLMode == SL_POINTS)
      return InpSLPoints * _Point;
   return 0;
  }

double TPDistance()
  {
   if(InpTPMode == TP_ATR)
      return (g_atr > 0 ? g_atr * InpTPATRMult : 0);
   if(InpTPMode == TP_POINTS)
      return InpTPPoints * _Point;
   return 0;
  }

double GridStep()
  {
   if(InpGridStepMode == STEP_ATR)
      return (g_atr > 0 ? g_atr * InpGridStepATR : 0);
   return InpGridStepPoints * _Point;
  }

//+------------------------------------------------------------------+
//| Precio en el que la posicion tendria "money" de ganancia          |
//+------------------------------------------------------------------+
double PriceForProfit(const ENUM_POSITION_TYPE type, const double vol, const double open, const double money)
  {
   double ref = 1000.0 * _Point;
   double p   = 0;
   ENUM_ORDER_TYPE ot = (type == POSITION_TYPE_BUY ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double close = (type == POSITION_TYPE_BUY ? open + ref : open - ref);
   if(!OrderCalcProfit(ot, _Symbol, vol, open, close, p) || p <= 0)
      return 0;
   double dist = money * ref / p;
   return NormalizePrice(type == POSITION_TYPE_BUY ? open + dist : open - dist);
  }

//+------------------------------------------------------------------+
//| Informacion de posiciones                                          |
//+------------------------------------------------------------------+
void GetBasket(const int e, SBasket &b)
  {
   ZeroMemory(b);
   long   magic = EngineMagic(e);
   double wsum  = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != magic)
         continue;
      double v  = PositionGetDouble(POSITION_VOLUME);
      double op = PositionGetDouble(POSITION_PRICE_OPEN);
      long   tm = PositionGetInteger(POSITION_TIME_MSC);
      b.count++;
      b.lots   += v;
      wsum     += op * v;
      b.profit += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      if(tm >= b.lastTimeMsc)
        {
         b.lastTimeMsc = tm;
         b.lastPrice   = op;
         b.lastLot     = v;
        }
      if(b.firstTimeMsc == 0 || tm < b.firstTimeMsc)
        {
         b.firstTimeMsc = tm;
         b.firstSL      = PositionGetDouble(POSITION_SL);
        }
     }
   if(b.lots > 0)
      b.avgPrice = wsum / b.lots;
  }

int CountOurPositions(const bool allSymbols)
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
         continue;
      if(!allSymbols && PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      n++;
     }
   return n;
  }

double SumOurLots()
  {
   double s = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
         s += PositionGetDouble(POSITION_VOLUME);
     }
   return s;
  }

bool InScope(const int scope, const string sym, const long magic)
  {
   if(scope == CLOSE_ALL_ACCOUNT)
      return true;
   if(sym != _Symbol)
      return false;
   if(scope == CLOSE_SYMBOL)
      return true;
   return IsOurMagic(magic);
  }

double FloatingInScope(const int scope, int &count)
  {
   double s = 0;
   count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(!InScope(scope, PositionGetString(POSITION_SYMBOL), PositionGetInteger(POSITION_MAGIC)))
         continue;
      s += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      count++;
     }
   return s;
  }

//+------------------------------------------------------------------+
//| Cierre de posiciones                                               |
//| pnlFilter: 0 = todas, 1 = solo ganadoras, -1 = solo perdedoras    |
//+------------------------------------------------------------------+
int CloseWhere(const int scope, const long onlyMagic, const int pnlFilter, const string why)
  {
   int closed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      long   mg  = PositionGetInteger(POSITION_MAGIC);
      if(!InScope(scope, sym, mg))
         continue;
      if(onlyMagic >= 0 && mg != onlyMagic)
         continue;
      double p = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      if(pnlFilter > 0 && p <= 0)
         continue;
      if(pnlFilter < 0 && p >= 0)
         continue;
      if(trade.PositionClose(t, InpSlippagePoints))
         closed++;
      else
         PrintFormat("[%s] No se pudo cerrar #%I64u: %u %s", why, t, trade.ResultRetcode(), trade.ResultRetcodeDescription());
     }
   if(closed > 0)
      PrintFormat("[%s] %d posicion(es) cerrada(s)", why, closed);
   return closed;
  }

//+------------------------------------------------------------------+
//| SL: solo se mueve a favor                                          |
//+------------------------------------------------------------------+
bool TightenSL(const ulong ticket, double newSL)
  {
   if(!PositionSelectByTicket(ticket))
      return false;
   ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   double curSL = PositionGetDouble(POSITION_SL);
   double tp    = PositionGetDouble(POSITION_TP);
   double minD  = MinStopDistance();
   double step  = MathMax(2 * _Point, g_atr * 0.03);
   newSL = NormalizePrice(newSL);
   if(newSL <= 0)
      return false;
   if(type == POSITION_TYPE_BUY)
     {
      double bid = Bid();
      if(newSL > bid - minD)
         newSL = NormalizePrice(bid - minD);
      if(curSL > 0 && newSL <= curSL + step)
         return false;
     }
   else
     {
      double ask = Ask();
      if(newSL < ask + minD)
         newSL = NormalizePrice(ask + minD);
      if(curSL > 0 && newSL >= curSL - step)
         return false;
     }
   if(!trade.PositionModify(ticket, newSL, tp))
     {
      uint rc = trade.ResultRetcode();
      if(rc != TRADE_RETCODE_NO_CHANGES)
         PrintFormat("No se pudo mover SL de #%I64u: %u %s", ticket, rc, trade.ResultRetcodeDescription());
      return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Pico de ganancia por posicion (persistido en variables globales)  |
//+------------------------------------------------------------------+
double GetPeak(const ulong ticket)
  {
   string n = PEAK_PREFIX + IntegerToString((long)ticket);
   return (GlobalVariableCheck(n) ? GlobalVariableGet(n) : 0.0);
  }

void SetPeak(const ulong ticket, const double v)
  {
   GlobalVariableSet(PEAK_PREFIX + IntegerToString((long)ticket), v);
  }

void CleanupPeaks()
  {
   static uint last = 0;
   if(last != 0 && GetTickCount() - last < 60000)
      return;
   last = GetTickCount();
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string n = GlobalVariableName(i);
      if(StringFind(n, PEAK_PREFIX) != 0)
         continue;
      ulong t = (ulong)StringToInteger(StringSubstr(n, StringLen(PEAK_PREFIX)));
      if(!PositionSelectByTicket(t))
         GlobalVariableDel(n);
     }
  }

//+------------------------------------------------------------------+
//| Senal                                                             |
//+------------------------------------------------------------------+
int TrendDir()
  {
   double t1 = Buf(hTrend, 0, 1);
   double c1 = iClose(_Symbol, InpTrendTF, 1);
   if(t1 == EMPTY_VALUE || c1 <= 0)
      return 0;
   int d = (c1 > t1 ? 1 : (c1 < t1 ? -1 : 0));
   if(d != 0 && InpTrendRequireSlope)
     {
      double tn = Buf(hTrend, 0, 1 + MathMax(1, InpTrendSlopeBars));
      if(tn == EMPTY_VALUE)
         return 0;
      if(d > 0 && t1 <= tn)
         d = 0;
      if(d < 0 && t1 >= tn)
         d = 0;
     }
   return d;
  }

// Devuelve false si los indicadores aun no tienen datos
bool ComputeSignal(int &sig)
  {
   sig = 0;
   int    sh = (InpUseClosedBar ? 1 : 0);
   double c  = iClose(_Symbol, InpMaTF, sh);
   double ma = Buf(hMA, 0, sh + InpMaShift);
   if(c <= 0 || ma == EMPTY_VALUE)
     {
      g_sigTxt = "Esperando datos...";
      return false;
     }
   int maDir = (c > ma ? 1 : (c < ma ? -1 : 0));
   string txt = "MA:" + DirTxt(maDir);
   sig = maDir;

   if(InpUseHILO)
     {
      double hi = Buf(hHiloH, 0, sh + InpHILOShift);
      double lo = Buf(hHiloL, 0, sh + InpHILOShift);
      if(hi == EMPTY_VALUE || lo == EMPTY_VALUE)
        {
         g_sigTxt = "Esperando datos HILO...";
         sig = 0;
         return false;
        }
      double px = (InpUseClosedBar ? iClose(_Symbol, InpHILOTF, sh) : Bid());
      int h = 0;
      if(px < lo)
         h = -1;
      else
         if(px > hi)
            h = 1;
      if(InpHILOInvert)
         h = -h;
      txt += " HILO:" + DirTxt(h);
      if(h != sig)
         sig = 0;
     }

   if(InpUseTrendFilter)
     {
      int td = TrendDir();
      txt += " TEND:" + DirTxt(td);
      if(sig != 0 && td != sig)
         sig = 0;
     }

   if(InpUseADX)
     {
      double adx = Buf(hADX, 0, 1);
      double pdi = Buf(hADX, 1, 1);
      double mdi = Buf(hADX, 2, 1);
      if(adx == EMPTY_VALUE || pdi == EMPTY_VALUE || mdi == EMPTY_VALUE)
        {
         txt += " ADX:--";
         sig = 0;
        }
      else
        {
         txt += StringFormat(" ADX:%.0f", adx);
         if(adx < InpADXMin)
            sig = 0;
         if(InpADXUseDI && sig > 0 && pdi <= mdi)
            sig = 0;
         if(InpADXUseDI && sig < 0 && mdi <= pdi)
            sig = 0;
        }
     }
   g_sigTxt = txt;
   return true;
  }

//+------------------------------------------------------------------+
//| Lotes                                                              |
//+------------------------------------------------------------------+
double BaseLot()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double ask = Ask();
   if(InpLotMode == LOT_PERCENT_MARGIN)
     {
      double m1 = 0;
      if(OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, 1.0, ask, m1) && m1 > 0)
         return (bal * InpPercentMargin / 100.0) / m1;
      return InpFixedLot;
     }
   if(InpLotMode == LOT_RISK_PERCENT)
     {
      double sd = SLDistance();
      double p  = 0;
      if(sd > 0 && OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, 1.0, ask, ask - sd, p) && p < 0)
         return (bal * InpRiskPercent / 100.0) / (-p);
      return InpFixedLot;
     }
   return InpFixedLot;
  }

double GridLot(const SBasket &b)
  {
   double base = BaseLot();
   int    n    = b.count;
   switch(InpGridLotType)
     {
      case GRID_SUM:
         return base * (n + 1);
      case GRID_MARTINGALE:
         return base * MathPow(InpGridFactor, n);
      case GRID_STEP:
         if(InpGridStepLot > 0 && n % InpGridStepLot == 0)
            return b.lastLot + base;
         return (b.lastLot > 0 ? b.lastLot : base);
      default:
         return base;
     }
  }

bool CanOpenMore(const double lot, string &why)
  {
   if(InpMaxTrades > 0 && CountOurPositions(InpMaxTradesAllSymbols) >= InpMaxTrades)
     {
      why = StringFormat("Max %d operaciones", InpMaxTrades);
      return false;
     }
   if(InpMaxTotalLots > 0 && SumOurLots() + lot > InpMaxTotalLots + 1e-9)
     {
      why = "Max lotes alcanzado";
      return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| TP de canasta (precio promedio +/- distancia)                      |
//+------------------------------------------------------------------+
void ApplyBasketTP(const int e)
  {
   if(InpTPMode != TP_ATR && InpTPMode != TP_POINTS)
      return;
   SBasket b;
   GetBasket(e, b);
   if(b.count == 0)
      return;
   double dist = TPDistance();
   if(dist <= 0)
      return;
   int    dir  = EngineDir(e);
   double minD = MinStopDistance();
   double tp   = NormalizePrice(b.avgPrice + dir * dist);
   if(dir > 0 && tp - Bid() < minD)
      tp = NormalizePrice(Bid() + minD);
   if(dir < 0 && Ask() - tp < minD)
      tp = NormalizePrice(Ask() - minD);
   long magic = EngineMagic(e);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != magic)
         continue;
      if(MathAbs(PositionGetDouble(POSITION_TP) - tp) > _Point / 2)
         trade.PositionModify(t, PositionGetDouble(POSITION_SL), tp);
     }
  }

//+------------------------------------------------------------------+
//| Apertura de ordenes                                                |
//+------------------------------------------------------------------+
bool OpenOrder(const int e, double lot, const bool isGrid, string &err)
  {
   int    dir   = EngineDir(e);
   long   magic = EngineMagic(e);
   lot = NormalizeLot(lot);

   double ask   = Ask();
   double bid   = Bid();
   double price = (dir > 0 ? ask : bid);
   double minD  = MinStopDistance();
   double sl    = 0;
   double tp    = 0;

   if(isGrid)
      sl = g_b[e].firstSL; // el grid comparte el SL de la primera orden
   else
     {
      double sd = SLDistance();
      if(sd > 0)
         sl = price - dir * sd;
      double td = TPDistance();
      if(td > 0)
         tp = price + dir * td;
     }

   if(sl > 0)
     {
      if(dir > 0 && bid - sl < minD)
        {
         if(isGrid)
           {
            err = "SL de la canasta muy cerca";
            return false;
           }
         sl = bid - minD;
        }
      if(dir < 0 && sl - ask < minD)
        {
         if(isGrid)
           {
            err = "SL de la canasta muy cerca";
            return false;
           }
         sl = ask + minD;
        }
      sl = NormalizePrice(sl);
     }
   if(tp > 0)
     {
      if(dir > 0 && tp - bid < minD)
         tp = bid + minD;
      if(dir < 0 && ask - tp < minD)
         tp = ask - minD;
      tp = NormalizePrice(tp);
     }

   double margin = 0;
   if(OrderCalcMargin(dir > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lot, price, margin)
      && margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE))
     {
      err = "Margen insuficiente";
      return false;
     }

   trade.SetExpertMagicNumber((ulong)magic);
   string cmt = StringFormat("%s %s%d", InpOrderComment, (e == 0 ? "A" : "B"), g_b[e].count + 1);
   bool ok = (dir > 0 ? trade.Buy(lot, _Symbol, 0.0, sl, tp, cmt)
                      : trade.Sell(lot, _Symbol, 0.0, sl, tp, cmt));
   uint rc = trade.ResultRetcode();
   if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_PLACED && rc != TRADE_RETCODE_DONE_PARTIAL))
     {
      err = StringFormat("Error %u %s", rc, trade.ResultRetcodeDescription());
      PrintFormat("No se pudo abrir %s %.3f: %s", (dir > 0 ? "BUY" : "SELL"), lot, err);
      return false;
     }
   PrintFormat("[Motor %s] %s %s %s @ %s  SL=%s  TP=%s  ATR=%s",
               (e == 0 ? "A" : "B"), (isGrid ? "GRID" : "ENTRADA"), (dir > 0 ? "BUY" : "SELL"),
               DoubleToString(lot, 3), DoubleToString(trade.ResultPrice(), _Digits),
               DoubleToString(sl, _Digits), DoubleToString(tp, _Digits), DoubleToString(g_atr, _Digits));
   GetBasket(e, g_b[e]);
   if(isGrid)
      ApplyBasketTP(e);
   return true;
  }

//+------------------------------------------------------------------+
//| Gestion de posiciones abiertas                                     |
//+------------------------------------------------------------------+
void ManagePositions()
  {
   for(int e = 0; e < 2; e++)
     {
      g_lockPeak[e]  = 0;
      g_lockLevel[e] = 0;
     }
   double pct = InpLockPercent / 100.0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      long mg = PositionGetInteger(POSITION_MAGIC);
      if(!IsOurMagic(mg))
         continue;

      int e = (mg == InpMagicA ? 0 : 1);
      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double vol    = PositionGetDouble(POSITION_VOLUME);
      double op     = PositionGetDouble(POSITION_PRICE_OPEN);
      double swap   = PositionGetDouble(POSITION_SWAP);
      double profit = PositionGetDouble(POSITION_PROFIT) + swap;

      // 1) Perdida maxima por operacion
      if(InpMaxLossPerTrade > 0 && profit <= -InpMaxLossPerTrade)
        {
         if(trade.PositionClose(t, InpSlippagePoints))
            PrintFormat("#%I64u cerrada por perdida maxima: %.2f (limite %.2f)", t, profit, InpMaxLossPerTrade);
         continue;
        }

      // 2) Profit Lock por posicion
      double peak = GetPeak(t);
      if(profit > peak)
        {
         peak = profit;
         SetPeak(t, peak);
        }
      bool perPos = InpUseProfitLock && (InpLockMode == LOCK_POSITION || g_b[e].count <= 1);
      if(perPos && peak >= InpLockStartMoney)
        {
         double lockMoney = peak * pct;
         if(peak > g_lockPeak[e])
           {
            g_lockPeak[e]  = peak;
            g_lockLevel[e] = lockMoney;
           }
         if(profit <= lockMoney)
           {
            if(trade.PositionClose(t, InpSlippagePoints))
               PrintFormat("#%I64u Profit Lock: pico %.2f, asegurado %.2f, cerrado en %.2f", t, peak, lockMoney, profit);
            continue;
           }
         if(InpLockMoveSL)
           {
            double lp = PriceForProfit(type, vol, op, lockMoney - swap);
            if(lp > 0)
               TightenSL(t, lp);
           }
        }

      // 3) Break-even / trailing por ATR
      if(g_atr > 0 && (InpUseBreakEven || InpUseATRTrailing))
        {
         double bid  = Bid();
         double ask  = Ask();
         double move = (type == POSITION_TYPE_BUY ? bid - op : op - ask);
         if(InpUseBreakEven && move >= InpBEStartATR * g_atr)
           {
            double be = (type == POSITION_TYPE_BUY ? op + InpBEOffsetATR * g_atr : op - InpBEOffsetATR * g_atr);
            TightenSL(t, be);
           }
         if(InpUseATRTrailing && move >= InpTrailStartATR * g_atr)
           {
            double ts = (type == POSITION_TYPE_BUY ? bid - InpTrailDistATR * g_atr : ask + InpTrailDistATR * g_atr);
            TightenSL(t, ts);
           }
        }
     }

   // 4) Profit Lock por canasta y TP en dinero
   for(int e = 0; e < 2; e++)
     {
      SBasket b;
      GetBasket(e, b);
      if(!InpUseProfitLock || InpLockMode != LOCK_BASKET || b.count < 2)
         g_basketPeak[e] = 0;
      else
        {
         if(b.profit > g_basketPeak[e])
            g_basketPeak[e] = b.profit;
         if(g_basketPeak[e] >= InpLockStartMoney)
           {
            double lock = g_basketPeak[e] * pct;
            g_lockPeak[e]  = g_basketPeak[e];
            g_lockLevel[e] = lock;
            if(b.profit <= lock)
              {
               PrintFormat("[Motor %s] Profit Lock canasta: pico %.2f, asegurado %.2f, actual %.2f",
                           (e == 0 ? "A" : "B"), g_basketPeak[e], lock, b.profit);
               CloseWhere(CLOSE_EA, EngineMagic(e), 0, "Profit Lock canasta");
               g_basketPeak[e] = 0;
               continue;
              }
           }
        }
      if(InpTPMode == TP_MONEY && InpTPMoney > 0 && b.count > 0 && b.profit >= InpTPMoney)
         CloseWhere(CLOSE_EA, EngineMagic(e), 0, "TP en dinero");
     }
  }

//+------------------------------------------------------------------+
//| Limites diarios                                                    |
//+------------------------------------------------------------------+
void UpdateDaily()
  {
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   int key = t.year * 10000 + t.mon * 100 + t.day;
   if(key == g_dayKey)
      return;
   g_dayKey = key;

   string kB = g_gvPrefix + "DAYB";
   string kD = g_gvPrefix + "DAYD";
   if(GlobalVariableCheck(kD) && GlobalVariableCheck(kB) && (int)GlobalVariableGet(kD) == key)
      g_dayBaseline = GlobalVariableGet(kB);
   else
     {
      g_dayBaseline = AccountInfoDouble(ACCOUNT_EQUITY);
      GlobalVariableSet(kB, g_dayBaseline);
      GlobalVariableSet(kD, key);
      g_dayLocked = false;
      PrintFormat("Nuevo dia %d: equity base %.2f", key, g_dayBaseline);
     }
   double dd = (InpDailyMode == LIMIT_MONEY ? InpMaxDailyDD : g_dayBaseline * InpMaxDailyDD / 100.0);
   double tg = (InpDailyMode == LIMIT_MONEY ? InpDailyTarget : g_dayBaseline * InpDailyTarget / 100.0);
   g_dayMin = (InpMaxDailyDD > 0 ? g_dayBaseline - dd : 0);
   g_dayMax = (InpDailyTarget > 0 ? g_dayBaseline + tg : 0);
  }

void StopEA(const string reason, const bool hard)
  {
   PrintFormat("PROTECCION: %s. Equity = %.2f", reason, AccountInfoDouble(ACCOUNT_EQUITY));
   CloseWhere(InpProtectScope, -1, 0, reason);
   if(hard)
      g_hardStop = true;
   else
      g_dayLocked = true;
   if(InpRemoveEAOnStop)
      ExpertRemove();
  }

// Devuelve true si se permite operar
bool CheckProtection(string &reason)
  {
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   int    n   = 0;
   double fl  = FloatingInScope(InpProtectScope, n);

   if(g_hardStop || g_dayLocked)
     {
      if(n > 0)
         CloseWhere(InpProtectScope, -1, 0, "Reintento cierre por proteccion");
      reason = (g_hardStop ? "Detenido por limite de equity" : "Limite diario alcanzado (hasta manana)");
      return false;
     }
   if(InpEquitySL > 0 && eq <= InpEquitySL)
     {
      StopEA("Equity por debajo de EquitySL", true);
      reason = "Equity SL";
      return false;
     }
   if(InpEquityTP > 0 && eq >= InpEquityTP)
     {
      StopEA("Equity por encima de EquityTP", true);
      reason = "Equity TP";
      return false;
     }
   if(g_dayMin > 0 && eq <= g_dayMin)
     {
      StopEA("Perdida diaria maxima alcanzada", false);
      reason = "Perdida diaria maxima";
      return false;
     }
   if(g_dayMax > 0 && eq >= g_dayMax)
     {
      StopEA("Objetivo diario alcanzado", false);
      reason = "Objetivo diario alcanzado";
      return false;
     }
   // Estos cierran pero no detienen el EA
   if(n > 0)
     {
      if(InpMaxFloatingDDMoney > 0 && fl <= -InpMaxFloatingDDMoney)
         CloseWhere(InpProtectScope, -1, 0, StringFormat("Max DD flotante %.2f", fl));
      else
         if(InpMaxFloatingDDPct > 0 && fl <= -bal * InpMaxFloatingDDPct / 100.0)
            CloseWhere(InpProtectScope, -1, 0, StringFormat("Max DD flotante %% %.2f", fl));
         else
            if(InpMaxFloatingProfitMoney > 0 && fl >= InpMaxFloatingProfitMoney)
               CloseWhere(InpProtectScope, -1, 0, StringFormat("Max ganancia flotante %.2f", fl));
            else
               if(InpMaxFloatingProfitPct > 0 && fl >= bal * InpMaxFloatingProfitPct / 100.0)
                  CloseWhere(InpProtectScope, -1, 0, StringFormat("Max ganancia flotante %% %.2f", fl));
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Horario                                                            |
//+------------------------------------------------------------------+
int ParseHM(string s)
  {
   StringTrimLeft(s);
   StringTrimRight(s);
   string p[];
   if(StringSplit(s, ':', p) < 1)
      return -1;
   int h = (int)StringToInteger(p[0]);
   int m = (ArraySize(p) > 1 ? (int)StringToInteger(p[1]) : 0);
   if(h < 0 || h > 24 || m < 0 || m > 59)
      return -1;
   return h * 60 + m;
  }

bool InTradingHours()
  {
   if(!InpUseTimeFilter)
      return true;
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   string s = "";
   switch(t.day_of_week)
     {
      case 0: s = InpSunday;    break;
      case 1: s = InpMonday;    break;
      case 2: s = InpTuesday;   break;
      case 3: s = InpWednesday; break;
      case 4: s = InpThursday;  break;
      case 5: s = InpFriday;    break;
      case 6: s = InpSaturday;  break;
     }
   StringTrimLeft(s);
   StringTrimRight(s);
   if(s == "")
      return true;
   string u = s;
   StringToUpper(u);
   if(u == "OFF")
      return false;
   int now = t.hour * 60 + t.min;
   string ranges[];
   int n = StringSplit(s, ',', ranges);
   for(int i = 0; i < n; i++)
     {
      string ab[];
      if(StringSplit(ranges[i], '-', ab) != 2)
         continue;
      int a = ParseHM(ab[0]);
      int b = ParseHM(ab[1]);
      if(a < 0 || b < 0)
         continue;
      if(a <= b)
        {
         if(now >= a && now < b)
            return true;
        }
      else
         if(now >= a || now < b)
            return true; // rango que cruza medianoche
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Noticias (calendario nativo de MT5)                                |
//+------------------------------------------------------------------+
void LoadNews()
  {
   ArrayResize(g_newsTimes, 0);
   ArrayResize(g_newsNames, 0);
   string curr[];
   int nc = 0;
   if(StringLen(InpNewsCurrencies) > 0)
      nc = StringSplit(InpNewsCurrencies, ',', curr);
   else
     {
      ArrayResize(curr, 2);
      curr[0] = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_BASE);
      curr[1] = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_PROFIT);
      nc = (curr[0] == curr[1] ? 1 : 2);
     }
   datetime now  = TimeTradeServer();
   datetime from = now - (datetime)((InpNewsAfterMin + 60) * 60);
   datetime to   = now + (datetime)((InpNewsBeforeMin + 24 * 60) * 60);
   for(int c = 0; c < nc; c++)
     {
      string cur = curr[c];
      StringTrimLeft(cur);
      StringTrimRight(cur);
      if(cur == "")
         continue;
      MqlCalendarValue vals[];
      int n = CalendarValueHistory(vals, from, to, NULL, cur);
      for(int i = 0; i < n; i++)
        {
         MqlCalendarEvent ev;
         if(!CalendarEventById(vals[i].event_id, ev))
            continue;
         bool ok = (ev.importance == CALENDAR_IMPORTANCE_HIGH && InpNewsHigh)
                   || (ev.importance == CALENDAR_IMPORTANCE_MODERATE && InpNewsMedium)
                   || (ev.importance == CALENDAR_IMPORTANCE_LOW && InpNewsLow);
         if(!ok)
            continue;
         int k = ArraySize(g_newsTimes);
         ArrayResize(g_newsTimes, k + 1);
         ArrayResize(g_newsNames, k + 1);
         g_newsTimes[k] = vals[i].time;
         g_newsNames[k] = cur + " " + ev.name;
        }
     }
   g_newsLoaded = now;
  }

bool NewsBlocked(string &info)
  {
   if(!InpUseNews || IsTester())
      return false;
   datetime now = TimeTradeServer();
   if(now - g_newsLoaded >= 900)
      LoadNews();
   for(int i = 0; i < ArraySize(g_newsTimes); i++)
     {
      if(now >= g_newsTimes[i] - InpNewsBeforeMin * 60 && now <= g_newsTimes[i] + InpNewsAfterMin * 60)
        {
         info = g_newsNames[i];
         return true;
        }
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Historial del dia (para el panel)                                  |
//+------------------------------------------------------------------+
void UpdateTodayHistory()
  {
   static uint last = 0;
   if(last != 0 && GetTickCount() - last < 5000)
      return;
   last = GetTickCount();
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   t.hour = 0;
   t.min  = 0;
   t.sec  = 0;
   datetime d0 = StructToTime(t);
   if(!HistorySelect(d0, TimeCurrent() + 60))
      return;
   double s = 0;
   int    n = 0;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0)
         continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol)
         continue;
      if(!IsOurMagic(HistoryDealGetInteger(d, DEAL_MAGIC)))
         continue;
      s += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP)
           + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_FEE);
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
         n++;
     }
   g_todayRealized = s;
   g_todayClosed   = n;
  }

//+------------------------------------------------------------------+
//| Entradas                                                           |
//+------------------------------------------------------------------+
void TryEntries(const bool canTrade, string &why)
  {
   if(!canTrade || !InpOpenNewOrders)
      return;
   datetime barTime = iTime(_Symbol, InpCandleTF, 0);

   for(int e = 0; e < 2; e++)
     {
      if(!EngineEnabled(e))
         continue;
      int dir = EngineDir(e);
      string err = "";

      if(g_b[e].count == 0)
        {
         // Entrada inicial: requiere senal, una por slot de senal y por vela
         if(g_signal != dir || g_entrySlot[e] == g_signalSlot)
            continue;
         if(InpOneOrderPerCandle && g_lastBar[e] == barTime)
            continue;
         if((InpSLMode == SL_ATR || InpTPMode == TP_ATR) && g_atr <= 0)
           {
            why = "ATR sin datos";
            continue;
           }
         double lot = BaseLot();
         if(!CanOpenMore(NormalizeLot(lot), why))
            continue;
         if(OpenOrder(e, lot, false, err))
           {
            g_entrySlot[e] = g_signalSlot;
            g_lastBar[e]   = barTime;
           }
         else
            why = err;
        }
      else
         if(InpEnableGrid && g_b[e].count < InpMaxGridLevels)
           {
            if(InpOneOrderPerCandle && g_lastBar[e] == barTime)
               continue;
            double step = GridStep();
            if(step <= 0)
               continue;
            bool trigger = (dir > 0 ? (g_b[e].lastPrice - Ask() >= step)
                                    : (Bid() - g_b[e].lastPrice >= step));
            if(!trigger)
               continue;
            if(InpGridRespectTrend && InpUseTrendFilter && TrendDir() != dir)
              {
               why = "Grid bloqueado: tendencia en contra";
               continue;
              }
            double lot = GridLot(g_b[e]);
            if(!CanOpenMore(NormalizeLot(lot), why))
               continue;
            if(OpenOrder(e, lot, true, err))
               g_lastBar[e] = barTime;
            else
               why = err;
           }
     }
  }

//+------------------------------------------------------------------+
//| Panel                                                              |
//+------------------------------------------------------------------+
void SetLabel(const string id, const int x, const int y, const string text,
              const color clr = CLR_TEXT, const int size = 9, const string font = "Consolas")
  {
   string n = OBJ_PREFIX + id;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, n, OBJPROP_TEXT, text);
   ObjectSetString(0, n, OBJPROP_FONT, font);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
  }

void SetButton(const string id, const int x, const int y, const int w, const int h,
               const string text, const color bg, const color fg = clrWhite)
  {
   string n = OBJ_PREFIX + id;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetString(0, n, OBJPROP_FONT, "Arial");
      ObjectSetInteger(0, n, OBJPROP_FONTSIZE, 8);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetString(0, n, OBJPROP_TEXT, text);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, fg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_COLOR, CLR_BORDER);
  }

void SetRect(const string id, const int x, const int y, const int w, const int h)
  {
   string n = OBJ_PREFIX + id;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, CLR_BG);
   ObjectSetInteger(0, n, OBJPROP_COLOR, CLR_BORDER);
  }

color PnLColor(const double v) { return (v > 0 ? CLR_GREEN : (v < 0 ? CLR_RED : CLR_TEXT)); }

void UpdatePanel(const bool force = false)
  {
   if(!InpShowPanel)
      return;
   static uint last = 0;
   if(!force && last != 0 && GetTickCount() - last < 300)
      return;
   last = GetTickCount();

   const int W  = 360;
   const int LH = 17;
   int x0 = InpPanelX;
   int y0 = InpPanelY;
   int x  = x0 + 10;
   int y  = y0 + 8;

   SetRect("BG", x0, y0, W, 10); // altura se ajusta al final

   string st;
   color  stc;
   if(g_hardStop)
     {
      st  = "DETENIDO: " + g_block;
      stc = CLR_RED;
     }
   else
      if(g_paused)
        {
         st  = "PAUSADO (solo gestiona posiciones abiertas)";
         stc = CLR_AMBER;
        }
      else
         if(g_block != "")
           {
            st  = "EN ESPERA: " + g_block;
            stc = CLR_AMBER;
           }
         else
           {
            st  = "OPERANDO";
            stc = CLR_GREEN;
           }

   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   long   spr = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   SetLabel("T0", x, y, "WEY TRADING BOT  v2.0", CLR_TITLE, 11, "Arial Black");
   y += LH + 6;
   SetLabel("L1", x, y, st, stc);
   y += LH;
   SetLabel("L2", x, y, StringFormat("%s | Spread %d pts | ATR %s", _Symbol, spr, DoubleToString(g_atr, _Digits)), CLR_MUTED);
   y += LH;
   SetLabel("L3", x, y, "Senal: " + SigName(g_signal) + "  " + g_sigTxt,
            (g_signal > 0 ? CLR_GREEN : (g_signal < 0 ? CLR_RED : CLR_TEXT)));
   y += LH + 4;

   for(int e = 0; e < 2; e++)
     {
      string name = (e == 0 ? "A (BUY) " : "B (SELL)");
      string head = EngineEnabled(e)
                    ? StringFormat("Motor %s: %d pos | %.3f lot | %+.2f", name, g_b[e].count, g_b[e].lots, g_b[e].profit)
                    : StringFormat("Motor %s: desactivado", name);
      SetLabel("E" + IntegerToString(e), x, y, head, (EngineEnabled(e) ? PnLColor(g_b[e].profit) : CLR_MUTED));
      y += LH;
      string lk;
      if(!InpUseProfitLock)
         lk = "   Profit Lock: desactivado";
      else
         if(g_lockPeak[e] > 0)
            lk = StringFormat("   Lock: pico %.2f -> asegurado %.2f (%.0f%%)", g_lockPeak[e], g_lockLevel[e], InpLockPercent);
         else
            lk = StringFormat("   Lock: se activa en +%.2f (asegura %.0f%%)", InpLockStartMoney, InpLockPercent);
      SetLabel("K" + IntegerToString(e), x, y, lk, (g_lockPeak[e] > 0 ? CLR_GREEN : CLR_MUTED));
      y += LH;
     }
   y += 4;

   double floating = g_b[0].profit + g_b[1].profit;
   SetLabel("L4", x, y, StringFormat("Hoy cerrado: %+.2f (%d ops) | Flotante: %+.2f", g_todayRealized, g_todayClosed, floating),
            PnLColor(g_todayRealized + floating));
   y += LH;
   SetLabel("L5", x, y, StringFormat("Dia: base %.2f | min %s | obj %s", g_dayBaseline,
                                     (g_dayMin > 0 ? DoubleToString(g_dayMin, 2) : "off"),
                                     (g_dayMax > 0 ? DoubleToString(g_dayMax, 2) : "off")), CLR_MUTED);
   y += LH;
   SetLabel("L6", x, y, StringFormat("Equity %.2f | Balance %.2f", eq, bal), CLR_TEXT);
   y += LH;
   SetLabel("L7", x, y, StringFormat("Max DD flotante %.2f | Min equity %.2f", g_maxFloatDD, g_minEquity), CLR_MUTED);
   y += LH + 8;

   int bw = (W - 20 - 2 * 6) / 3;
   int bh = 22;
   SetButton("BTN_CLOSEALL", x, y, bw, bh, "Cerrar todo", C'120,40,40');
   SetButton("BTN_CLOSEPROFIT", x + bw + 6, y, bw, bh, "Cerrar ganancias", C'30,110,80');
   SetButton("BTN_CLOSELOSS", x + 2 * (bw + 6), y, bw, bh, "Cerrar perdidas", C'140,90,20');
   y += bh + 6;
   SetButton("BTN_BUY", x, y, bw, bh, "BUY manual (A)", C'30,80,150');
   SetButton("BTN_SELL", x + bw + 6, y, bw, bh, "SELL manual (B)", C'150,40,60');
   SetButton("BTN_PAUSE", x + 2 * (bw + 6), y, bw, bh, (g_paused ? "Reanudar" : "Pausar"), (g_paused ? C'30,110,80' : CLR_BTN));
   y += bh + 8;

   ObjectSetInteger(0, OBJ_PREFIX + "BG", OBJPROP_YSIZE, y - y0);
   ChartRedraw();
  }

void DeletePanel()
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

bool Confirm(const string text, const string caption)
  {
   if(IsTester())
      return true;
   return (MessageBox(text, caption, MB_YESNO | MB_ICONQUESTION) == IDYES);
  }

//+------------------------------------------------------------------+
//| Eventos                                                            |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpSignalIntervalMin < 1)
     {
      Alert("El intervalo de senal debe ser al menos 1 minuto");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpUseProfitLock && (InpLockPercent <= 0 || InpLockPercent >= 100 || InpLockStartMoney <= 0))
     {
      Alert("Profit Lock: el % debe estar entre 0 y 100 y el monto de activacion debe ser > 0");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpMaxLossPerTrade < 0 || InpMaxDailyDD < 0 || InpDailyTarget < 0)
     {
      Alert("Los limites de perdida/objetivo no pueden ser negativos");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpDailyMode == LIMIT_PERCENT && InpMaxDailyDD > 100)
     {
      Alert("La perdida diaria en % no puede ser mayor a 100");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(!InpEnableEngineA && !InpEnableEngineB)
      Alert("Ambos motores estan desactivados: el EA solo gestionara posiciones existentes");
   if(InpMagicA == InpMagicB)
     {
      Alert("Los magic numbers de los motores A y B deben ser distintos");
      return INIT_PARAMETERS_INCORRECT;
     }

   hMA    = iMA(_Symbol, InpMaTF, InpMaPeriod, 0, InpMaMethod, InpMaPrice);
   hHiloH = iMA(_Symbol, InpHILOTF, InpHILOPeriod, 0, InpHILOMethod, PRICE_HIGH);
   hHiloL = iMA(_Symbol, InpHILOTF, InpHILOPeriod, 0, InpHILOMethod, PRICE_LOW);
   hTrend = iMA(_Symbol, InpTrendTF, InpTrendMaPeriod, 0, InpTrendMaMethod, PRICE_CLOSE);
   hADX   = iADX(_Symbol, InpADXTF, InpADXPeriod);
   hATR   = iATR(_Symbol, InpATRTF, InpATRPeriod);
   if(hMA == INVALID_HANDLE || hHiloH == INVALID_HANDLE || hHiloL == INVALID_HANDLE
      || hTrend == INVALID_HANDLE || hADX == INVALID_HANDLE || hATR == INVALID_HANDLE)
     {
      Alert("No se pudieron crear los indicadores. Error ", GetLastError());
      return INIT_FAILED;
     }

   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();
   trade.LogLevel(LOG_LEVEL_ERRORS);

   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      Print("AVISO: la cuenta no es de cobertura (hedging). Con netting, el grid y los motores A/B se compensan entre si.");

   g_gvPrefix = StringFormat("WEY_%I64d_%I64d_%I64d_", AccountInfoInteger(ACCOUNT_LOGIN), InpMagicA, InpMagicB);
   g_minEquity  = AccountInfoDouble(ACCOUNT_EQUITY);
   g_maxFloatDD = 0;
   g_wasInHours = InTradingHours();
   g_dayKey     = 0;
   UpdateDaily();
   GetBasket(0, g_b[0]);
   GetBasket(1, g_b[1]);

   ChartSetInteger(0, CHART_FOREGROUND, false);
   UpdatePanel(true);
   PrintFormat("Wey Trading Bot v2 iniciado en %s. Vol min %.3f, paso %.3f, digitos %d",
               _Symbol, SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN),
               SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), _Digits);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   if(hMA != INVALID_HANDLE)    IndicatorRelease(hMA);
   if(hHiloH != INVALID_HANDLE) IndicatorRelease(hHiloH);
   if(hHiloL != INVALID_HANDLE) IndicatorRelease(hHiloL);
   if(hTrend != INVALID_HANDLE) IndicatorRelease(hTrend);
   if(hADX != INVALID_HANDLE)   IndicatorRelease(hADX);
   if(hATR != INVALID_HANDLE)   IndicatorRelease(hATR);
   DeletePanel();
   Comment("");
  }

void OnTick()
  {
   // 1) Datos de mercado y estadisticas
   double atr = Buf(hATR, 0, 1);
   g_atr = (atr == EMPTY_VALUE ? 0 : atr);
   UpdateDaily();
   CleanupPeaks();

   GetBasket(0, g_b[0]);
   GetBasket(1, g_b[1]);

   // 2) Gestion de posiciones (siempre, aunque no se permitan entradas)
   ManagePositions();
   GetBasket(0, g_b[0]);
   GetBasket(1, g_b[1]);

   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double fl = g_b[0].profit + g_b[1].profit;
   if(-fl > g_maxFloatDD)
      g_maxFloatDD = -fl;
   if(eq < g_minEquity)
      g_minEquity = eq;
   UpdateTodayHistory();

   // 3) Filtros que bloquean nuevas entradas
   bool   canTrade = true;
   string why      = "";

   if(!CheckProtection(why))
      canTrade = false;

   bool inHours = InTradingHours();
   if(!inHours)
     {
      if(canTrade)
         why = "Fuera de horario";
      canTrade = false;
      if(g_wasInHours && InpCloseOutsideHours)
         CloseWhere(CLOSE_EA, -1, 0, "Fuera de horario");
     }
   g_wasInHours = inHours;

   string newsInfo = "";
   bool   isNews   = NewsBlocked(newsInfo);
   if(isNews)
     {
      if(canTrade)
         why = "Noticia: " + newsInfo;
      canTrade = false;
      if(!g_wasNews && InpNewsCloseTrades)
         CloseWhere(CLOSE_EA, -1, 0, "Noticia " + newsInfo);
     }
   g_wasNews = isNews;

   double spreadPx = Ask() - Bid();
   long   spreadPt = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(canTrade && InpMaxSpreadPoints > 0 && spreadPt > InpMaxSpreadPoints)
     {
      why = StringFormat("Spread alto (%d pts)", spreadPt);
      canTrade = false;
     }
   if(canTrade && InpMaxSpreadATRPct > 0 && g_atr > 0 && spreadPx > g_atr * InpMaxSpreadATRPct / 100.0)
     {
      why = StringFormat("Spread alto (%.0f%% del ATR)", 100.0 * spreadPx / g_atr);
      canTrade = false;
     }
   if(canTrade && (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED)))
     {
      why = "Trading automatico desactivado";
      canTrade = false;
     }
   if(g_paused)
      canTrade = false;

   // 4) Senal (una evaluacion por intervalo)
   long slot = (long)TimeCurrent() / ((long)InpSignalIntervalMin * 60);
   if(slot != g_signalSlot)
     {
      int sig = 0;
      if(ComputeSignal(sig))
        {
         g_signal     = sig;
         g_signalSlot = slot;
        }
     }

   // 5) Entradas y grid
   TryEntries(canTrade, why);

   g_block = why;
   UpdatePanel();
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK || StringFind(sparam, OBJ_PREFIX + "BTN_") != 0)
      return;
   ObjectSetInteger(0, sparam, OBJPROP_STATE, false);

   if(sparam == OBJ_PREFIX + "BTN_CLOSEALL")
     {
      if(Confirm(StringFormat("Cerrar TODAS las posiciones del EA en %s?\nP/L actual: %.2f", _Symbol, g_b[0].profit + g_b[1].profit), "Cerrar todo"))
         CloseWhere(CLOSE_EA, -1, 0, "Manual: cerrar todo");
     }
   else
      if(sparam == OBJ_PREFIX + "BTN_CLOSEPROFIT")
        {
         if(Confirm("Cerrar las posiciones del EA en ganancia?", "Cerrar ganancias"))
            CloseWhere(CLOSE_EA, -1, 1, "Manual: cerrar ganancias");
        }
      else
         if(sparam == OBJ_PREFIX + "BTN_CLOSELOSS")
           {
            if(Confirm("Cerrar las posiciones del EA en perdida?", "Cerrar perdidas"))
               CloseWhere(CLOSE_EA, -1, -1, "Manual: cerrar perdidas");
           }
         else
            if(sparam == OBJ_PREFIX + "BTN_PAUSE")
              {
               g_paused = !g_paused;
               PrintFormat("EA %s manualmente", (g_paused ? "pausado" : "reanudado"));
              }
            else
               if(sparam == OBJ_PREFIX + "BTN_BUY" || sparam == OBJ_PREFIX + "BTN_SELL")
                 {
                  int e = (sparam == OBJ_PREFIX + "BTN_BUY" ? 0 : 1);
                  GetBasket(e, g_b[e]);
                  string err = "";
                  double lot = BaseLot();
                  if(g_b[e].count > 0)
                     Print("Manual: el motor ya tiene posiciones abiertas");
                  else
                     if(!CanOpenMore(NormalizeLot(lot), err))
                        Print("Manual: ", err);
                     else
                        if(Confirm(StringFormat("Abrir %s manual de %.3f lotes?", (e == 0 ? "BUY" : "SELL"), NormalizeLot(lot)), "Orden manual"))
                           OpenOrder(e, lot, false, err);
                 }
   GetBasket(0, g_b[0]);
   GetBasket(1, g_b[1]);
   UpdatePanel(true);
  }

double OnTester()
  {
   // Factor de recuperacion: beneficio neto / drawdown maximo de equity
   double profit = TesterStatistics(STAT_PROFIT);
   double dd     = TesterStatistics(STAT_EQUITY_DD);
   if(dd <= 0)
      dd = 1;
   return profit / dd;
  }
//+------------------------------------------------------------------+
