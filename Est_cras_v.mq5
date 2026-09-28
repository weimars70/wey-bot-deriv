//+------------------------------------------------------------------+
//|                                              H1_LastCloseLine.mq5 |
//|   Marca una linea horizontal en el CIERRE (Close) de la ultima    |
//|   vela H1 completada (donde termino en H1, sin importar si quedo  |
//|   en la mitad de la vela).                                        |
//|   Se actualiza automaticamente cada vez que arranca una vela H1   |
//|   nueva, borrando la linea y recuadros anteriores.                |
//|   Detecta hasta 3 patrones en V pegados a la linea azul           |
//|   e incluye botones de navegacion para llegar facil en el grafico |
//+------------------------------------------------------------------+
#property copyright "Estrategia por partes"
#property version   "1.50"
#property strict

#include <Trade\Trade.mqh>

//--- Enumeraciones
enum ENUM_V_LINE_PRICE
{
   V_LINE_PRICE_LOW   = 0, // Minimo (Low / Mecha inferior)
   V_LINE_PRICE_CLOSE = 1  // Cierre (Close / Base de la vela)
};

enum ENUM_BOX_TARGET
{
   BOX_TARGET_RED_CANDLE = 0, // Recuadro en la vela roja de la V
   BOX_TARGET_FULL_V     = 1  // Recuadro en todo el patron V
};


//--- Parametros configurables desde las propiedades del EA
input group "=== Configuracion Colores de Velas ==="
input bool            SetCandleColors    = true;           // Aplicar colores a las velas
input color           BullCandleColor    = clrGreen;       // Color velas alcistas (cuerpo y borde)
input color           BearCandleColor    = clrRed;         // Color velas bajistas (cuerpo y borde)

input group "=== Configuracion Linea H1 ==="
input color           LineColor          = clrDodgerBlue;  // Color de la linea H1
input int             LineWidth          = 1;              // Grosor de la linea
input ENUM_LINE_STYLE LineStyle          = STYLE_SOLID;    // Estilo de la linea
input bool            ShowLabel          = true;           // Mostrar precio como etiqueta

input group "=== Configuracion Linea V (Morada) ==="
input bool              ShowVLine        = true;              // Mostrar linea horizontal morada en la V
input color             V_LineColor      = clrPurple;         // Color morado de la linea horizontal de la V
input int               V_LineWidth      = 1;                 // Grosor de la linea morada
input ENUM_LINE_STYLE   V_LineStyle      = STYLE_SOLID;       // Estilo de la linea morada
input ENUM_V_LINE_PRICE V_LinePriceMode  = V_LINE_PRICE_LOW;  // Parte inferior de vela roja (Low o Close)

input group "=== Configuracion Rectangulo Tiempo Real (3 velas M5) ==="
input bool            ShowRealtimeBox        = true;              // Activar rectangulo en tiempo real
input color           RealtimeBoxColor       = clrMediumPurple;   // Color del rectangulo tiempo real
input int             RealtimeBoxWidth       = 2;                 // Grosor del borde
input ENUM_LINE_STYLE RealtimeBoxStyle       = STYLE_SOLID;       // Estilo del borde
input bool            RealtimeBoxFill        = false;             // Rellenar recuadro con color
input int             M5CandlesCount         = 3;                 // Cantidad de velas M5 hacia arriba
input double          CustomM5Height         = 0.0;               // Altura fija por vela M5 (0 = calcular automatico)
input bool            BoxFromHourStart       = true;              // Fijar rectangulo desde el inicio de la hora H1 (no se desplaza)

input group "=== Configuracion Operativa / Entradas ==="
input bool            EnableAutoTrading      = true;              // Activar entradas automaticas al rectangulo
input bool            OnlyStrategy           = false;             // Switch "Solo Estrategia": ON = pura caja V sin filtros; OFF = evalua todo lo demas
input bool            AutoLotBySymbol        = true;              // Lotaje automatico (1.00 en 300/500/1000 y 0.50 en 600/900)
input double          TradeLotSize           = 0.0;               // Lotaje manual fijo (si > 0 y AutoLotBySymbol = false)
input ulong           MagicNumber            = 112233;            // Numero magico del EA
input int             SlippagePoints         = 10;                // Desviacion maxima / Slippage
input bool            OneTradePerHour        = false;             // Limitar a 1 operacion por hora (false = permite varias entradas no concurrentes)
input double          TakeProfitPoints       = 0.0;               // Take Profit en puntos (0 = sin TP fijo, gestion por spike / tiempo)
input bool            EnableTradeAlerts      = true;              // Mostrar alerta sonora/visual al entrar o salir

input group "=== Gestion de Salidas (USD, Spikes y Tiempo) ==="
input double          MaxLossUSD             = 3.0;               // Stop Loss en USD: cerrar inmediatamente si llega a -3 USD
input double          MinProfitUSD           = 3.0;               // Ganancia minima en USD para cerrar tras spike (menos de 3 USD deja correr)
input int             MaxMinutesWithoutSpike = 15;                // Minutos maximos sin spike para evaluar salida
input bool            ManageSpikeExit        = true;              // Cerrar operacion tras spike si profit >= 3 USD
input int             WaitSecondsAfterSpike  = 300;               // Tiempo de espera tras spike (300 seg = 1 vela M5)
input double          CustomSpikeDrop        = 0.0;               // Caida minima para considerar spike (0 = auto segun Crash)
input int             CooldownAfterClose     = 15;                // Segundos de pausa tras cerrar antes de buscar otra oportunidad

input group "=== Filtros de Seguridad y Alta Probabilidad ==="
input bool            ShowDashboard          = true;              // Mostrar monitor de diagnostico en vivo en el grafico
input bool            UseTrendFilter         = true;              // Filtro 1: Tendencia (Solo SELL si precio bajo EMA)
input ENUM_TIMEFRAMES TrendTimeframe         = PERIOD_M15;        // Temporalidad de la EMA (M15 o H1)
input int             TrendEmaPeriod         = 50;                // Periodo de la EMA de tendencia (ej: 50 o 200)
input bool            UseRsiFilter           = false;             // Filtro 2: Sobrecompra RSI (55.0 para tendencia bajista)
input ENUM_TIMEFRAMES RsiTimeframe           = PERIOD_M5;         // Temporalidad del RSI (M5 o M1)
input int             RsiPeriod              = 14;                // Periodo del RSI
input double          RsiMinLevel            = 55.0;              // Nivel minimo de RSI para entrar (55.0 recomendado)
input bool            UseConsecutiveM1Filter = false;             // Filtro 3: Acumulacion (4 velas M1 verdes seguidas)
input int             MinConsecutiveGreenM1  = 4;                 // Velas M1 verdes seguidas sin spike previo
input bool            BlockReentryOnLoss     = true;              // Filtro 4: Anti-Racha (Bloquear reentradas en la misma H1 tras perdida)

input group "=== Continuacion de Tendencia Bajista (Opcion B) ==="
input bool            EnableTrendContinuation    = true;              // Activar entradas por continuacion de tendencia (fuera de caja)
input int             TrendContinuationGreenBars = 2;                 // Velas verdes M1 de micro-retroceso para entrar (ej: 2 a 4)
input bool            RequireBelowH1Line         = true;              // Exigir que el precio este por debajo del cierre H1 anterior
input int             MaxTradesPerH1Trend        = 3;                 // Maximo de operaciones por continuacion por hora H1

input group "=== Configuracion Patron V ==="
input ENUM_TIMEFRAMES V_Timeframe        = PERIOD_M5;      // Timeframe para buscar la V (por defecto M5)
input int             SearchDays         = 30;             // Dias hacia atras para escanear (30 dias)
input double          MaxDistance        = 1000.0;         // Distancia maxima encima de la linea azul
input bool            DistanceInPoints   = false;          // true = multiplicar por _Point, false = unidades directas
input int             V_BarsAround       = 5;              // Rango de velas a izquierda/derecha para confirmar la V
input double          MinVDepth          = 0.1;            // Altura minima de la V (subida/bajada minima)
input ENUM_BOX_TARGET V_BoxTarget        = BOX_TARGET_RED_CANDLE; // Donde dibujar el recuadro
input color           V_BoxColor         = clrRed;         // Color del recuadro de la V
input int             V_BoxWidth         = 2;              // Grosor del recuadro
input ENUM_LINE_STYLE V_BoxStyle         = STYLE_SOLID;    // Estilo del borde del recuadro
input bool            V_BoxFill          = false;          // Rellenar recuadro con color
input int             MaxBarsSearch      = 10000;          // Maximo de velas hacia atras para escanear (10000 = ~35 dias en M5)

// Nombres de objetos
string   LineName       = "H1_LastCloseLine";
string   LabelName      = "H1_LastCloseLabel";
string   VBoxPrefix             = "V_Pattern_Box_";
string   VArrowPrefix           = "V_Pattern_Arrow_";
string   VLinePrefix            = "V_Pattern_Line_";
string   VLineName              = "V_Pattern_Closest_Line"; // Solo UNA linea morada en el punto mas cercano
string   RealtimeBoxName        = "H1_Realtime_M5_Box";     // Rectangulo tiempo real de 3 velas M5
string   BtnPrevName            = "V_Nav_Btn_Prev";
string   BtnInfoName            = "V_Nav_Btn_Info";
string   BtnNextName            = "V_Nav_Btn_Next";
string   BtnTradeName           = "V_Btn_AutoTrade";
string   BtnModeName            = "V_Btn_OnlyStrategy";

// Variables globales de trading y estado del rectangulo
CTrade   trade;
double   g_rectPriceLow         = 0.0;
double   g_rectPriceHigh        = 0.0;
bool     g_rectActive           = false;
datetime g_lastTradeHour        = 0;
bool     g_autoTradeActive      = true;
bool     g_onlyStrategy         = false;

// Variables para gestion de Spikes
double   g_lastTrackedBid       = 0.0;
datetime g_lastSpikeTime        = 0;
bool     g_spikeDetected        = false;
ulong    g_activeTicket         = 0;
datetime g_lastCloseTime        = 0;
datetime g_positionOpenTime     = 0;
datetime g_lossHour             = 0;

// Handles para indicadores tecnicos
int      g_emaHandle            = INVALID_HANDLE;
int      g_rsiHandle            = INVALID_HANDLE;
int      g_trendContTradesInHour= 0;

datetime lastH1BarTime          = 0;
datetime g_realtimeBoxStartTime = 0;

// Estructura para almacenar las posiciones de las V encontradas
struct VPatternInfo
{
   datetime timeStart;
   datetime timeCenter;
   datetime timeEnd;
   double   priceHigh;
   double   priceLow;
   double   priceVLine;
};

// Estructura para candidatos de V ordenados por distancia a la linea azul
struct VCandidate
{
   int      redBar;
   datetime timeStart;
   datetime timeCenter;
   datetime timeEnd;
   double   priceHigh;
   double   priceLow;
   double   vLinePrice;
   double   distToBlue;
};

VPatternInfo g_vPatterns[];
int          g_vTotal        = 0;
int          g_vCurrentIndex = -1;

// Prototipos de filtros de confirmacion
bool IsTrendBearish();
bool IsRsiOverbought(double &currentRsi);
int  GetConsecutiveGreenM1();

//+------------------------------------------------------------------+
//| Borra todos los recuadros, flechas y lineas moradas de las V     |
//+------------------------------------------------------------------+
void ClearVBoxes()
{
   ObjectDelete(0, VLineName);
   ObjectsDeleteAll(0, VBoxPrefix);
   ObjectsDeleteAll(0, VArrowPrefix);
   ObjectsDeleteAll(0, VLinePrefix);
}

//+------------------------------------------------------------------+
//| Borra los botones de navegacion                                  |
//+------------------------------------------------------------------+
void ClearNavButtons()
{
   ObjectDelete(0, BtnPrevName);
   ObjectDelete(0, BtnInfoName);
   ObjectDelete(0, BtnNextName);
   ObjectDelete(0, BtnTradeName);
   ObjectDelete(0, BtnModeName);
}

//+------------------------------------------------------------------+
//| Borra todos los objetos creados por el EA                         |
//+------------------------------------------------------------------+
void ClearObjects()
{
   ObjectDelete(0, LineName);
   ObjectDelete(0, LabelName);
   ObjectDelete(0, RealtimeBoxName);
   g_realtimeBoxStartTime = 0;
   g_rectActive           = false;
   ClearVBoxes();
   ClearNavButtons();
}

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| Crea o actualiza el boton para centrar el unico punto encontrado |
//+------------------------------------------------------------------+
void CreateNavButtons()
{
   int corner = CORNER_LEFT_UPPER;
   int yPos   = 35;
   int xStart = 20;

   // Boton para centrar el punto mas cercano
   if(ObjectFind(0, BtnInfoName) < 0)
   {
      ObjectCreate(0, BtnInfoName, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_CORNER, corner);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_XDISTANCE, xStart);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_YDISTANCE, yPos);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_XSIZE, 130);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_YSIZE, 24);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_BGCOLOR, C'20,25,35');
      ObjectSetInteger(0, BtnInfoName, OBJPROP_COLOR, clrYellow);
      ObjectSetString(0, BtnInfoName, OBJPROP_FONT, "Segoe UI");
      ObjectSetInteger(0, BtnInfoName, OBJPROP_FONTSIZE, 9);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_STATE, false);
      ObjectSetString(0, BtnInfoName, OBJPROP_TOOLTIP, "Click para centrar en pantalla el punto mas cercano a la linea azul");
   }

   // Boton para activar / desactivar AutoTrading en tiempo real
   if(ObjectFind(0, BtnTradeName) < 0)
   {
      ObjectCreate(0, BtnTradeName, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_CORNER, corner);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_XDISTANCE, xStart + 135);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_YDISTANCE, yPos);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_XSIZE, 120);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_YSIZE, 24);
      ObjectSetString(0, BtnTradeName, OBJPROP_FONT, "Segoe UI");
      ObjectSetInteger(0, BtnTradeName, OBJPROP_FONTSIZE, 9);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, BtnTradeName, OBJPROP_STATE, false);
      ObjectSetString(0, BtnTradeName, OBJPROP_TOOLTIP, "Click para activar/desactivar entradas automaticas");
   }

   // Boton Switch "Solo Estrategia" (ON = Solo Caja V; OFF = Evalua todo lo demas)
   if(ObjectFind(0, BtnModeName) < 0)
   {
      ObjectCreate(0, BtnModeName, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, BtnModeName, OBJPROP_CORNER, corner);
      ObjectSetInteger(0, BtnModeName, OBJPROP_XDISTANCE, xStart + 260);
      ObjectSetInteger(0, BtnModeName, OBJPROP_YDISTANCE, yPos);
      ObjectSetInteger(0, BtnModeName, OBJPROP_XSIZE, 145);
      ObjectSetInteger(0, BtnModeName, OBJPROP_YSIZE, 24);
      ObjectSetString(0, BtnModeName, OBJPROP_FONT, "Segoe UI");
      ObjectSetInteger(0, BtnModeName, OBJPROP_FONTSIZE, 9);
      ObjectSetInteger(0, BtnModeName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, BtnModeName, OBJPROP_STATE, false);
      ObjectSetString(0, BtnModeName, OBJPROP_TOOLTIP, "Click para alternar: Solo Estrategia V (ON) o Evalua Todo lo Demas (OFF)");
   }

   // Asegurar que botones viejos no queden en pantalla
   ObjectDelete(0, BtnPrevName);
   ObjectDelete(0, BtnNextName);

   UpdateNavButtonsText();
}

//+------------------------------------------------------------------+
//| Actualiza el texto del boton informativo                          |
//+------------------------------------------------------------------+
void UpdateNavButtonsText()
{
   if(ObjectFind(0, BtnInfoName) >= 0)
   {
      string infoText = (g_vTotal > 0) ? "Centrar Punto V" : "Buscando V...";
      ObjectSetString(0, BtnInfoName, OBJPROP_TEXT, infoText);
      ObjectSetInteger(0, BtnInfoName, OBJPROP_STATE, false);
   }

   if(ObjectFind(0, BtnTradeName) >= 0)
   {
      if(EnableAutoTrading && g_autoTradeActive)
      {
         string tradeText = "AutoTrade: ON";
         if(g_activeTicket > 0)
         {
            double liveProfit = 0.0;
            for(int p = PositionsTotal() - 1; p >= 0; p--)
            {
               if(PositionGetTicket(p) == g_activeTicket)
               {
                  liveProfit = PositionGetDouble(POSITION_PROFIT);
                  break;
               }
            }

            if(g_spikeDetected && g_lastSpikeTime > 0)
            {
               int remain = MathMax(0, WaitSecondsAfterSpike - (int)(TimeCurrent() - g_lastSpikeTime));
               tradeText = StringFormat("Spike:%ds (%+.2f$)", remain, liveProfit);
            }
            else if(!g_spikeDetected && g_positionOpenTime > 0 && MaxMinutesWithoutSpike > 0)
            {
               int elapsed = (int)(TimeCurrent() - g_positionOpenTime);
               int remain = MathMax(0, (MaxMinutesWithoutSpike * 60) - elapsed);
               tradeText = StringFormat("%02d:%02d (%+.2f$)", remain / 60, remain % 60, liveProfit);
            }
            else
            {
               tradeText = StringFormat("Trade: %+.2f$", liveProfit);
            }

            if(liveProfit >= MinProfitUSD)
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'10,120,50');
            else if(liveProfit <= -2.0)
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'130,20,20');
            else
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'20,80,40');
         }
         else
         {
            double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
            datetime currentH1 = iTime(_Symbol, PERIOD_H1, 0);

            if(BlockReentryOnLoss && g_lossHour > 0 && g_lossHour == currentH1)
            {
               tradeText = "Pausa: SL H1";
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'70,25,25');
            }
            else if(g_rectActive && currentBid >= g_rectPriceLow && currentBid < g_rectPriceHigh)
            {
               if(!IsTrendBearish())
                  tradeText = "Filtro: EMA Bull";
               else
                  tradeText = "Listo: Caja SELL";
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'10,120,50');
            }
            else if(EnableTrendContinuation && IsTrendBearish())
            {
               int greenM1 = GetConsecutiveGreenM1();
               if(greenM1 >= TrendContinuationGreenBars)
               {
                  tradeText = StringFormat("Tend: SELL (%dv)", greenM1);
                  ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'10,120,50');
               }
               else
               {
                  tradeText = StringFormat("Tend: %d/%dv", greenM1, TrendContinuationGreenBars);
                  ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'20,80,40');
               }
            }
            else
            {
               tradeText = "AutoTrade: ON";
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'20,80,40');
            }
         }
         ObjectSetString(0, BtnTradeName, OBJPROP_TEXT, tradeText);
         ObjectSetInteger(0, BtnTradeName, OBJPROP_COLOR, clrWhite);
      }
      else
      {
         ObjectSetString(0, BtnTradeName, OBJPROP_TEXT, "AutoTrade: OFF");
         ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'70,25,25');
         ObjectSetInteger(0, BtnTradeName, OBJPROP_COLOR, clrSilver);
      }
      ObjectSetInteger(0, BtnTradeName, OBJPROP_STATE, false);
   }

   // Actualizar texto y color del boton switch Solo Estrategia
   if(ObjectFind(0, BtnModeName) >= 0)
   {
      if(g_onlyStrategy)
      {
         ObjectSetString(0, BtnModeName, OBJPROP_TEXT, "Estrategia: SOLO V (ON)");
         ObjectSetInteger(0, BtnModeName, OBJPROP_BGCOLOR, C'0,105,160');
         ObjectSetInteger(0, BtnModeName, OBJPROP_COLOR, clrWhite);
      }
      else
      {
         ObjectSetString(0, BtnModeName, OBJPROP_TEXT, "Filtros: TODOS (ON)");
         ObjectSetInteger(0, BtnModeName, OBJPROP_BGCOLOR, C'45,45,60');
         ObjectSetInteger(0, BtnModeName, OBJPROP_COLOR, clrWhite);
      }
      ObjectSetInteger(0, BtnModeName, OBJPROP_STATE, false);
   }
}

//+------------------------------------------------------------------+
//| Mueve el grafico a la V seleccionada                             |
//+------------------------------------------------------------------+
void NavigateToV(int index)
{
   if(index < 0 || index >= g_vTotal)
      return;

   g_vCurrentIndex = index;

   datetime targetTime = g_vPatterns[index].timeCenter;

   // Desactivamos el desplazamiento automatico
   ChartSetInteger(0, CHART_AUTOSCROLL, false);

   // Calculamos el shift en el timeframe del grafico actual
   int shift = iBarShift(_Symbol, _Period, targetTime, false);
   if(shift >= 0)
   {
      int visibleBars = (int)ChartGetInteger(0, CHART_VISIBLE_BARS);
      if(visibleBars <= 0)
         visibleBars = 40;

      int targetShift = shift + (visibleBars / 3);
      ChartNavigate(0, CHART_END, targetShift);
   }

   UpdateNavButtonsText();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Gestion de eventos de clic en los botones del grafico             |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      if(sparam == BtnInfoName)
      {
         ObjectSetInteger(0, BtnInfoName, OBJPROP_STATE, false);
         if(g_vTotal > 0)
         {
            NavigateToV(0);
         }
      }
      else if(sparam == BtnTradeName)
      {
         ObjectSetInteger(0, BtnTradeName, OBJPROP_STATE, false);
         g_autoTradeActive = !g_autoTradeActive;
         UpdateNavButtonsText();
         ChartRedraw(0);
      }
      else if(sparam == BtnModeName)
      {
         ObjectSetInteger(0, BtnModeName, OBJPROP_STATE, false);
         g_onlyStrategy = !g_onlyStrategy;
         UpdateNavButtonsText();
         UpdateChartComment();
         ChartRedraw(0);
      }
   }
}

//+------------------------------------------------------------------+
//| Configura los colores de las velas alcistas y bajistas           |
//+------------------------------------------------------------------+
void ApplyChartColors()
{
   if(!SetCandleColors)
      return;

   ChartSetInteger(0, CHART_MODE, CHART_CANDLES);
   ChartSetInteger(0, CHART_COLOR_CHART_UP, BullCandleColor);      // Borde y mecha vela alcista
   ChartSetInteger(0, CHART_COLOR_CHART_DOWN, BearCandleColor);    // Borde y mecha vela bajista
   ChartSetInteger(0, CHART_COLOR_CANDLE_BULL, BullCandleColor);   // Cuerpo vela alcista (verde)
   ChartSetInteger(0, CHART_COLOR_CANDLE_BEAR, BearCandleColor);   // Cuerpo vela bajista (rojo)
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Inicializacion                                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   ApplyChartColors();

   // Inicializar CTrade con configuracion
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   g_autoTradeActive       = EnableAutoTrading;
   g_onlyStrategy          = OnlyStrategy;
   g_lossHour              = 0;
   g_trendContTradesInHour = 0;

   // Inicializar handles de indicadores para filtros
   if(UseTrendFilter)
   {
      g_emaHandle = iMA(_Symbol, TrendTimeframe, TrendEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(g_emaHandle == INVALID_HANDLE)
         Print("Advertencia: No se pudo crear handle para EMA de tendencia.");
   }

   if(UseRsiFilter)
   {
      g_rsiHandle = iRSI(_Symbol, RsiTimeframe, RsiPeriod, PRICE_CLOSE);
      if(g_rsiHandle == INVALID_HANDLE)
         Print("Advertencia: No se pudo crear handle para RSI.");
   }

   // Timer cada segundo para asegurar deteccion inmediata del cambio de hora
   EventSetTimer(1);

   lastH1BarTime = iTime(_Symbol, PERIOD_H1, 0);

   ClearObjects();
   RecalculateHourly();

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Limpieza al quitar el EA del grafico                              |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   ClearObjects();

   if(g_emaHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_emaHandle);
      g_emaHandle = INVALID_HANDLE;
   }
   if(g_rsiHandle != INVALID_HANDLE)
   {
      IndicatorRelease(g_rsiHandle);
      g_rsiHandle = INVALID_HANDLE;
   }

   Comment("");
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Cada tick: actualiza hora, rectangulo, gestiona spikes y opera   |
//+------------------------------------------------------------------+
void OnTick()
{
   CheckNewH1Bar();
   UpdateRealtimeBox();
   ManageOpenPositionAndSpikes();
   CheckTradeEntry();
   UpdateChartComment();
}

//+------------------------------------------------------------------+
//| Cada segundo: actualiza estado y temporizador de spikes          |
//+------------------------------------------------------------------+
void OnTimer()
{
   CheckNewH1Bar();
   UpdateRealtimeBox();
   ManageOpenPositionAndSpikes();
   CheckTradeEntry();
   UpdateNavButtonsText();
   UpdateChartComment();
}

//+------------------------------------------------------------------+
//| Revisa si cambio la hora (nueva vela H1)                         |
//+------------------------------------------------------------------+
void CheckNewH1Bar()
{
   datetime currentH1BarTime = iTime(_Symbol, PERIOD_H1, 0);
   if(currentH1BarTime <= 0)
      return;

   // Si arranco una hora nueva (nueva vela H1)
   if(currentH1BarTime != lastH1BarTime)
   {
      lastH1BarTime = currentH1BarTime;
      g_realtimeBoxStartTime = 0;
      g_lossHour = 0; // Se reinicia bloqueo anti-racha para la nueva hora
      g_trendContTradesInHour = 0; // Se reinicia contador de continuacion de tendencia

      // 1. Borramos la linea H1, la etiqueta, los rectangulos y las lineas moradas
      ClearObjects();

      // 2. Volvemos a hacer todo el proceso: nueva linea H1, nuevas V, nuevos rectangulos y lineas moradas
      RecalculateHourly();
   }
}

//+------------------------------------------------------------------+
//| Recalcula la linea H1 y busca las V pegadas a la linea           |
//+------------------------------------------------------------------+
void RecalculateHourly()
{
   DrawLastH1CloseLine();
   UpdateVPatterns();
   UpdateRealtimeBox();
   CreateNavButtons();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Dibuja o actualiza la linea horizontal en el ultimo cierre H1     |
//+------------------------------------------------------------------+
void DrawLastH1CloseLine()
{
   double lastClose = iClose(_Symbol, PERIOD_H1, 1); // 1 = ultima vela H1 completada; Close = precio donde termino la vela
   if(lastClose <= 0)
      return;

   if(ObjectFind(0, LineName) < 0)
   {
      ObjectCreate(0, LineName, OBJ_HLINE, 0, 0, lastClose);
      ObjectSetInteger(0, LineName, OBJPROP_COLOR, LineColor);
      ObjectSetInteger(0, LineName, OBJPROP_WIDTH, LineWidth);
      ObjectSetInteger(0, LineName, OBJPROP_STYLE, LineStyle);
      ObjectSetInteger(0, LineName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, LineName, OBJPROP_BACK, true);
      ObjectSetString(0, LineName, OBJPROP_TOOLTIP, "Cierre (donde termino) ultima H1");
   }
   else
   {
      ObjectSetDouble(0, LineName, OBJPROP_PRICE, lastClose);
   }

   if(ShowLabel)
      DrawLabel(lastClose);
}

//+------------------------------------------------------------------+
//| Busca hacia atras hasta 3 V pegadas sobre la linea H1            |
//+------------------------------------------------------------------+
void UpdateVPatterns()
{
   double h1Price = iClose(_Symbol, PERIOD_H1, 1);
   if(h1Price <= 0)
      return;

   // Forzamos M5 como temporalidad de busqueda de la V segun estrategia
   ENUM_TIMEFRAMES tf = (V_Timeframe == PERIOD_CURRENT) ? PERIOD_M5 : V_Timeframe;

   // Limpiamos los recuadros anteriores y reseteamos el arreglo
   ClearVBoxes();
   ArrayResize(g_vPatterns, 1);
   g_vTotal = 0;
   g_vCurrentIndex = -1;

   // Calculamos el limite de barras equivalente a SearchDays (30 dias = ~8640 velas M5)
   datetime startTimeLimit = TimeCurrent() - (SearchDays * 86400);
   int shiftLimit = iBarShift(_Symbol, tf, startTimeLimit, false);
   if(shiftLimit <= 0)
      shiftLimit = SearchDays * 288;

   int totalBars = iBars(_Symbol, tf);
   int limit = MathMin(shiftLimit, totalBars - 2);
   if(MaxBarsSearch > 0)
      limit = MathMin(limit, MaxBarsSearch);

   // Margenes permitidos con respecto a la linea azul (estrictamente encima de la linea azul)
   double maxDistVal  = DistanceInPoints ? (MaxDistance * _Point) : MaxDistance;
   double minDepthVal = DistanceInPoints ? (MinVDepth * _Point) : MinVDepth;

   VCandidate candidates[];
   int candCount = 0;

   // 1. Escaneamos vela por vela en M5 hacia atras en todo el historial de 30 dias
   for(int k = 1; k < limit; k++)
   {
      // Condicion 1: La vela en M5 debe ser ROJA (bajista: Close < Open)
      if(iClose(_Symbol, tf, k) >= iOpen(_Symbol, tf, k))
         continue;

      // Nivel de precio en la parte inferior de la vela roja
      double vLinePrice = (V_LinePriceMode == V_LINE_PRICE_CLOSE) ? iClose(_Symbol, tf, k) : iLow(_Symbol, tf, k);

      // Condicion 2: La vela roja y su linea morada DEBEN estar estrictamente por encima o sobre la linea azul
      if(vLinePrice < h1Price)
         continue;

      // Condicion 3: Distancia a la linea azul dentro del rango maximo
      double dist = vLinePrice - h1Price;
      if(dist > maxDistVal)
         continue;

      int redBar = k;

      datetime boxTimeStart = iTime(_Symbol, tf, redBar);
      datetime boxTimeEnd   = boxTimeStart + PeriodSeconds(tf);
      double   boxPriceHigh = iHigh(_Symbol, tf, redBar);
      double   boxPriceLow  = iLow(_Symbol, tf, redBar);

      ArrayResize(candidates, candCount + 1);
      candidates[candCount].redBar     = redBar;
      candidates[candCount].timeStart  = boxTimeStart;
      candidates[candCount].timeCenter = iTime(_Symbol, tf, redBar);
      candidates[candCount].timeEnd    = boxTimeEnd;
      candidates[candCount].priceHigh  = boxPriceHigh;
      candidates[candCount].priceLow   = boxPriceLow;
      candidates[candCount].vLinePrice = vLinePrice;
      candidates[candCount].distToBlue = dist;
      candCount++;
   }

   // 2. Ordenamos los candidatos por menor distancia a la linea azul (el mas cercano primero)
   for(int i = 0; i < candCount - 1; i++)
   {
      int minIdx = i;
      for(int j = i + 1; j < candCount; j++)
      {
         if(candidates[j].distToBlue < candidates[minIdx].distToBlue)
            minIdx = j;
      }
      if(minIdx != i)
      {
         VCandidate temp = candidates[i];
         candidates[i] = candidates[minIdx];
         candidates[minIdx] = temp;
      }
   }

   // 3. Dibujamos SOLO UNA linea morada en el punto MAS CERCANO a la linea azul
   if(candCount > 0)
   {
      DrawVLine(candidates[0].vLinePrice, candidates[0].distToBlue);
   }

   // 4. Marcamos UNICAMENTE UN SOLO PUNTO (el mas cercano a la linea azul)
   if(candCount > 0)
   {
      ArrayResize(g_vPatterns, 1);
      g_vTotal = 1;
      g_vCurrentIndex = 0;

      g_vPatterns[0].timeStart  = candidates[0].timeStart;
      g_vPatterns[0].timeCenter = candidates[0].timeCenter;
      g_vPatterns[0].timeEnd    = candidates[0].timeEnd;
      g_vPatterns[0].priceHigh  = candidates[0].priceHigh;
      g_vPatterns[0].priceLow   = candidates[0].priceLow;
      g_vPatterns[0].priceVLine = candidates[0].vLinePrice;

      string boxName   = VBoxPrefix + "1";
      string arrowName = VArrowPrefix + "1";

      DrawVBox(boxName, candidates[0].timeStart, candidates[0].priceHigh, candidates[0].timeEnd, candidates[0].priceLow, 1);
      DrawVIndicator(arrowName, candidates[0].timeCenter, candidates[0].priceLow, 1);
   }
   else
   {
      ArrayResize(g_vPatterns, 0);
      g_vTotal = 0;
      g_vCurrentIndex = -1;
   }
}

//+------------------------------------------------------------------+
//| Dibuja o actualiza un recuadro para una V encontrada              |
//+------------------------------------------------------------------+
void DrawVBox(string name, datetime time1, double price1, datetime time2, double price2, int index)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, time1, price1, time2, price2);
      ObjectSetInteger(0, name, OBJPROP_COLOR, V_BoxColor);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, V_BoxWidth);
      ObjectSetInteger(0, name, OBJPROP_STYLE, V_BoxStyle);
      ObjectSetInteger(0, name, OBJPROP_FILL, V_BoxFill);
      ObjectSetInteger(0, name, OBJPROP_BACK, false); // Primer plano visible
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, name, OBJPROP_TOOLTIP, StringFormat("Patron V #%d", index));
   }
   else
   {
      ObjectMove(0, name, 0, time1, price1);
      ObjectMove(0, name, 1, time2, price2);
      ObjectSetInteger(0, name, OBJPROP_COLOR, V_BoxColor);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, V_BoxWidth);
      ObjectSetInteger(0, name, OBJPROP_STYLE, V_BoxStyle);
      ObjectSetInteger(0, name, OBJPROP_FILL, V_BoxFill);
      ObjectSetInteger(0, name, OBJPROP_BACK, false);
   }
}

//+------------------------------------------------------------------+
//| Dibuja un marcador visible (flecha y texto) bajo el piso de la V  |
//+------------------------------------------------------------------+
void DrawVIndicator(string name, datetime timeCenter, double priceLow, int index)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_TEXT, 0, timeCenter, priceLow);
      ObjectSetInteger(0, name, OBJPROP_COLOR, V_BoxColor);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 10);
      ObjectSetInteger(0, name, OBJPROP_ANCHOR, ANCHOR_TOP);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, name, OBJPROP_TEXT, StringFormat("▲ V#%d", index));
   }
   else
   {
      ObjectMove(0, name, 0, timeCenter, priceLow);
      ObjectSetString(0, name, OBJPROP_TEXT, StringFormat("▲ V#%d", index));
   }
}

//+------------------------------------------------------------------+
//| Dibuja una unica linea horizontal morada en la V mas cercana     |
//+------------------------------------------------------------------+
void DrawVLine(double price, double distance)
{
   if(!ShowVLine || price <= 0)
      return;

   if(ObjectFind(0, VLineName) < 0)
   {
      ObjectCreate(0, VLineName, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, VLineName, OBJPROP_COLOR, V_LineColor);
      ObjectSetInteger(0, VLineName, OBJPROP_WIDTH, V_LineWidth);
      ObjectSetInteger(0, VLineName, OBJPROP_STYLE, V_LineStyle);
      ObjectSetInteger(0, VLineName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, VLineName, OBJPROP_BACK, true);
      ObjectSetString(0, VLineName, OBJPROP_TOOLTIP, StringFormat("V mas cercana a linea H1 (Distancia: %s): %s", DoubleToString(distance, _Digits), DoubleToString(price, _Digits)));
   }
   else
   {
      ObjectMove(0, VLineName, 0, 0, price);
      ObjectSetInteger(0, VLineName, OBJPROP_COLOR, V_LineColor);
      ObjectSetInteger(0, VLineName, OBJPROP_WIDTH, V_LineWidth);
      ObjectSetInteger(0, VLineName, OBJPROP_STYLE, V_LineStyle);
      ObjectSetString(0, VLineName, OBJPROP_TOOLTIP, StringFormat("V mas cercana a linea H1 (Distancia: %s): %s", DoubleToString(distance, _Digits), DoubleToString(price, _Digits)));
   }
}

//+------------------------------------------------------------------+
//| Etiqueta de texto con el precio, pegada al borde derecho          |
//+------------------------------------------------------------------+
void DrawLabel(double price)
{
   if(ObjectFind(0, LabelName) < 0)
   {
      ObjectCreate(0, LabelName, OBJ_TEXT, 0, TimeCurrent(), price);
      ObjectSetInteger(0, LabelName, OBJPROP_COLOR, LineColor);
      ObjectSetInteger(0, LabelName, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, LabelName, OBJPROP_SELECTABLE, false);
   }
   else
   {
      ObjectMove(0, LabelName, 0, TimeCurrent(), price);
   }
   ObjectSetString(0, LabelName, OBJPROP_TEXT, "H1 close: " + DoubleToString(price, _Digits));
}

//+------------------------------------------------------------------+
//| Calcula la altura promedio de una vela normal de M5              |
//+------------------------------------------------------------------+
double GetM5CandleHeight()
{
   if(CustomM5Height > 0)
      return CustomM5Height;

   int totalM5 = iBars(_Symbol, PERIOD_M5);
   if(totalM5 <= 0)
      return 10.0;

   int scanBars = 50;
   int limit = MathMin(scanBars, totalM5 - 1);

   double ranges[];
   ArrayResize(ranges, 0);

   for(int i = 1; i <= limit; i++)
   {
      double o = iOpen(_Symbol, PERIOD_M5, i);
      double c = iClose(_Symbol, PERIOD_M5, i);
      double h = iHigh(_Symbol, PERIOD_M5, i);
      double l = iLow(_Symbol, PERIOD_M5, i);

      // En Crash, las velas normales de subida son verdes (c >= o)
      if(c >= o && (h - l) > 0)
      {
         int sz = ArraySize(ranges);
         ArrayResize(ranges, sz + 1);
         ranges[sz] = (h - l);
      }
   }

   if(ArraySize(ranges) > 0)
   {
      ArraySort(ranges);
      int mid = ArraySize(ranges) / 2;
      return ranges[mid];
   }

   // Fallback: promedio de las ultimas 3 velas M5
   double sum = 0;
   int cnt = 0;
   for(int i = 1; i <= 3 && i < totalM5; i++)
   {
      sum += (iHigh(_Symbol, PERIOD_M5, i) - iLow(_Symbol, PERIOD_M5, i));
      cnt++;
   }
   return (cnt > 0 && sum > 0) ? (sum / cnt) : 10.0;
}

//+------------------------------------------------------------------+
//| Calcula la altura promedio de una vela normal de M1 (sin spikes) |
//+------------------------------------------------------------------+
double GetM1CandleHeight()
{
   int totalM1 = iBars(_Symbol, PERIOD_M1);
   if(totalM1 <= 0)
      return (GetM5CandleHeight() / 5.0);

   int scanBars = 60;
   int limit = MathMin(scanBars, totalM1 - 1);

   double ranges[];
   ArrayResize(ranges, 0);

   for(int i = 1; i <= limit; i++)
   {
      double o = iOpen(_Symbol, PERIOD_M1, i);
      double c = iClose(_Symbol, PERIOD_M1, i);
      double h = iHigh(_Symbol, PERIOD_M1, i);
      double l = iLow(_Symbol, PERIOD_M1, i);

      // En Crash, las velas normales de acumulacion (subida) son verdes (c >= o)
      if(c >= o && (h - l) > 0)
      {
         int sz = ArraySize(ranges);
         ArrayResize(ranges, sz + 1);
         ranges[sz] = (h - l);
      }
   }

   if(ArraySize(ranges) > 0)
   {
      ArraySort(ranges);
      int mid = ArraySize(ranges) / 2; // Mediana para descartar anomalias
      return ranges[mid];
   }

   return (GetM5CandleHeight() / 5.0);
}

//+------------------------------------------------------------------+
//| Filtro 1: Verifica si el precio esta en tendencia bajista (SELL) |
//+------------------------------------------------------------------+
bool IsTrendBearish()
{
   if(!UseTrendFilter)
      return true;

   if(g_emaHandle == INVALID_HANDLE)
   {
      g_emaHandle = iMA(_Symbol, TrendTimeframe, TrendEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(g_emaHandle == INVALID_HANDLE)
         return true;
   }

   double emaVal[1];
   if(CopyBuffer(g_emaHandle, 0, 0, 1, emaVal) <= 0)
      return true;

   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   // Para operar SELL en Crash, buscamos que el precio este por debajo de la EMA
   return (currentBid < emaVal[0]);
}

//+------------------------------------------------------------------+
//| Filtro 2: Verifica si el RSI esta en zona de sobrecompra         |
//+------------------------------------------------------------------+
bool IsRsiOverbought(double &currentRsi)
{
   currentRsi = 0.0;
   if(!UseRsiFilter)
      return true;

   if(g_rsiHandle == INVALID_HANDLE)
   {
      g_rsiHandle = iRSI(_Symbol, RsiTimeframe, RsiPeriod, PRICE_CLOSE);
      if(g_rsiHandle == INVALID_HANDLE)
         return true;
   }

   double rsiVal[1];
   if(CopyBuffer(g_rsiHandle, 0, 0, 1, rsiVal) <= 0)
      return true;

   currentRsi = NormalizeDouble(rsiVal[0], 1);
   return (currentRsi >= RsiMinLevel);
}

//+------------------------------------------------------------------+
//| Filtro 3: Cuenta velas verdes consecutivas en M1 sin spike       |
//+------------------------------------------------------------------+
int GetConsecutiveGreenM1()
{
   int count = 0;
   int total = iBars(_Symbol, PERIOD_M1);
   int limit = MathMin(50, total - 1);

   for(int i = 1; i <= limit; i++)
   {
      double o = iOpen(_Symbol, PERIOD_M1, i);
      double c = iClose(_Symbol, PERIOD_M1, i);

      // Si la vela cerro por debajo de la apertura (vela roja / spike), se corta la racha
      if(c < o)
         break;

      count++;
   }

   return count;
}

//+------------------------------------------------------------------+
//| Actualiza el panel de diagnostico en vivo en el grafico          |
//+------------------------------------------------------------------+
void UpdateChartComment()
{
   if(!ShowDashboard)
   {
      Comment("");
      return;
   }

   if(!EnableAutoTrading || !g_autoTradeActive)
   {
      Comment("\n=== ESTRATEGIA CRASH V - AUTOTRADE: OFF ===");
      return;
   }

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   datetime currentH1 = iTime(_Symbol, PERIOD_H1, 0);

   // Estado de la zona del rectangulo
   string boxStatus = "Sin zona activa";
   bool inBox = false;
   if(g_rectActive && g_rectPriceLow > 0)
   {
      inBox = (bid >= g_rectPriceLow && bid < g_rectPriceHigh);
      if(inBox)
         boxStatus = StringFormat("DENTRO (%.*f - %.*f)", _Digits, g_rectPriceLow, _Digits, g_rectPriceHigh);
      else if(bid < g_rectPriceLow)
         boxStatus = StringFormat("DEBAJO (Faltan %.*f pts para llegar)", _Digits, g_rectPriceLow - bid);
      else
         boxStatus = StringFormat("ENCIMA (Paso por %.*f pts)", _Digits, bid - g_rectPriceHigh);
   }

   // Estado Filtro 1: Tendencia EMA
   string trendStr = "Desactivado";
   bool trendOk = true;
   if(UseTrendFilter)
   {
      double emaVal[1] = {0};
      if(g_emaHandle != INVALID_HANDLE && CopyBuffer(g_emaHandle, 0, 0, 1, emaVal) > 0)
      {
         trendOk = (bid < emaVal[0]);
         trendStr = trendOk ? StringFormat("OK (Bajista: %.*f < %.*f)", _Digits, bid, _Digits, emaVal[0])
                            : StringFormat("BLOQUEADO (Alcista: %.*f > %.*f)", _Digits, bid, _Digits, emaVal[0]);
      }
      else
      {
         trendStr = "Cargando datos EMA...";
      }
   }

   // Estado Filtro 2: RSI
   string rsiStr = "Desactivado";
   bool rsiOk = true;
   if(UseRsiFilter)
   {
      double rsiVal = 0.0;
      rsiOk = IsRsiOverbought(rsiVal);
      rsiStr = rsiOk ? StringFormat("OK (RSI: %.1f >= %.0f)", rsiVal, RsiMinLevel)
                     : StringFormat("BLOQUEADO (RSI: %.1f < %.0f)", rsiVal, RsiMinLevel);
   }

   // Estado Filtro 3: Acumulacion M1
   string greenStr = "Desactivado";
   bool greenOk = true;
   if(UseConsecutiveM1Filter)
   {
      int greenCount = GetConsecutiveGreenM1();
      greenOk = (greenCount >= MinConsecutiveGreenM1);
      greenStr = greenOk ? StringFormat("OK (%d/%d velas)", greenCount, MinConsecutiveGreenM1)
                         : StringFormat("BLOQUEADO (%d/%d velas)", greenCount, MinConsecutiveGreenM1);
   }

   // Estado Filtro 4: Anti-Racha
   string rachaStr = "OK (Libre)";
   bool rachaOk = true;
   if(BlockReentryOnLoss && g_lossHour > 0 && g_lossHour == currentH1)
   {
      rachaOk = false;
      rachaStr = "BLOQUEADO (Perdida reciente en esta hora H1)";
   }

   // Estado Opcion B: Continuacion de tendencia
   string trendContStr = "Desactivado";
   bool trendContOk = false;
   if(EnableTrendContinuation)
   {
      double h1Close = iClose(_Symbol, PERIOD_H1, 1);
      bool h1Ok = (!RequireBelowH1Line || (h1Close > 0 && bid < h1Close));
      int greenM1 = GetConsecutiveGreenM1();
      bool greenContOk = (greenM1 >= TrendContinuationGreenBars);

      if(!h1Ok)
         trendContStr = "Precio sobre linea H1";
      else if(!trendOk)
         trendContStr = "EMA no bajista";
      else if(g_trendContTradesInHour >= MaxTradesPerH1Trend)
         trendContStr = StringFormat("Limite %d/%d trades alcanzado", g_trendContTradesInHour, MaxTradesPerH1Trend);
      else if(!greenContOk)
         trendContStr = StringFormat("Retroceso: %d/%d velas M1", greenM1, TrendContinuationGreenBars);
      else
      {
         trendContOk = true;
         trendContStr = StringFormat("LISTO (%d/%d velas M1)", greenM1, TrendContinuationGreenBars);
      }
   }

   // Resumen global
   string generalStatus = "";
   if(CountOpenPositions() > 0)
      generalStatus = "OPERACION EN CURSO (Monitoreando salida)";
   else if(!rachaOk)
      generalStatus = "PAUSA POR SL EN ESTA H1 (Esperando proxima hora)";
   else if(g_onlyStrategy)
   {
      if(inBox)
         generalStatus = "SOLO ESTRATEGIA: PRECIO EN CAJA V -> DISPARANDO SELL!";
      else
         generalStatus = "SOLO ESTRATEGIA: Esperando que el precio suba a la Caja V";
   }
   else if(inBox && trendOk && rsiOk && greenOk)
      generalStatus = "SEÑAL ACTIVA: DENTRO DE ZONA RECTANGULO -> SELL!";
   else if(trendContOk)
      generalStatus = "SEÑAL ACTIVA: CONTINUACION DE TENDENCIA -> SELL!";
   else if(inBox)
      generalStatus = "DENTRO DE ZONA: Esperando filtros de entrada";
   else if(EnableTrendContinuation && trendOk)
      generalStatus = StringFormat("TENDENCIA BAJISTA: %s", trendContStr);
   else
      generalStatus = "ESPERANDO CONDICIONES (Zona o Tendencia)";

   string modeStr = g_onlyStrategy ? "SOLO ESTRATEGIA PURA (ON: Sin Filtros)" : "MODO COMPLETO (OFF: Con Filtros y Continuacion)";

   string msg = StringFormat(
      "\n=======================================================\n" +
      "  ESTRATEGIA CRASH V - MONITOR EN TIEMPO REAL\n" +
      "=======================================================\n" +
      " • Switch Modo:      %s\n" +
      " • Zona Rectangulo:  %s\n" +
      " • Precio Actual:    %.*f\n" +
      "-------------------------------------------------------\n" +
      " [1] Tendencia (%s EMA%d): %s\n" +
      " [2] Sobrecompra RSI (%s): %s\n" +
      " [3] Acumulacion M1:        %s\n" +
      " [4] Anti-Racha H1:         %s\n" +
      " [B] Continuacion Tendencia: %s\n" +
      "-------------------------------------------------------\n" +
      " >> ESTADO: %s\n" +
      "=======================================================\n",
      modeStr, boxStatus, _Digits, bid,
      EnumToString(TrendTimeframe), TrendEmaPeriod, trendStr,
      EnumToString(RsiTimeframe), rsiStr,
      greenStr, rachaStr, trendContStr, generalStatus
   );

   Comment(msg);
}

//+------------------------------------------------------------------+
//| Dibuja/actualiza el rectangulo en tiempo real de 3 velas M5      |
//+------------------------------------------------------------------+
void UpdateRealtimeBox()
{
   if(!ShowRealtimeBox)
   {
      ObjectDelete(0, RealtimeBoxName);
      g_rectActive = false;
      return;
   }

   // Verificamos si existe la linea morada y si hay V encontrada
   if(g_vTotal <= 0 || g_vPatterns[0].priceVLine <= 0)
   {
      ObjectDelete(0, RealtimeBoxName);
      g_rectActive = false;
      return;
   }

   double purplePrice = g_vPatterns[0].priceVLine;
   double m5Height    = GetM5CandleHeight();
   double boxHeight   = m5Height * M5CandlesCount;

   double priceLow    = purplePrice;
   double priceHigh   = purplePrice + boxHeight;

   // Guardar precios del rectangulo para la ejecucion de entradas
   g_rectPriceLow  = priceLow;
   g_rectPriceHigh = priceHigh;
   g_rectActive    = true;

   datetime h1StartTime = iTime(_Symbol, PERIOD_H1, 0);
   datetime h1EndTime   = h1StartTime + 3600; // Donde termina la hora en curso

   datetime timeStart;
   if(BoxFromHourStart || g_realtimeBoxStartTime == 0)
   {
      timeStart = h1StartTime;
      g_realtimeBoxStartTime = h1StartTime;
   }
   else
   {
      timeStart = g_realtimeBoxStartTime;
   }

   datetime timeEnd = h1EndTime;

   if(ObjectFind(0, RealtimeBoxName) < 0)
   {
      ObjectCreate(0, RealtimeBoxName, OBJ_RECTANGLE, 0, timeStart, priceHigh, timeEnd, priceLow);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_COLOR, RealtimeBoxColor);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_WIDTH, RealtimeBoxWidth);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_STYLE, RealtimeBoxStyle);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_FILL, RealtimeBoxFill);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_BACK, true);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, RealtimeBoxName, OBJPROP_TOOLTIP, StringFormat("Rectangulo %d velas M5 sobre linea morada hasta fin de H1", M5CandlesCount));
   }
   else
   {
      ObjectMove(0, RealtimeBoxName, 0, timeStart, priceHigh);
      ObjectMove(0, RealtimeBoxName, 1, timeEnd, priceLow);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_COLOR, RealtimeBoxColor);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_WIDTH, RealtimeBoxWidth);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_STYLE, RealtimeBoxStyle);
      ObjectSetInteger(0, RealtimeBoxName, OBJPROP_FILL, RealtimeBoxFill);
      ObjectSetString(0, RealtimeBoxName, OBJPROP_TOOLTIP, StringFormat("Rectangulo %d velas M5 sobre linea morada hasta fin de H1", M5CandlesCount));
   }
}

//+------------------------------------------------------------------+
//| Cuenta las posiciones abiertas por este EA en este simbolo       |
//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            PositionGetInteger(POSITION_MAGIC) == MagicNumber)
         {
            count++;
         }
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Ajusta el lotaje a los limites permitidos por el broker          |
//+------------------------------------------------------------------+
double NormalizeLotSize(double lot)
{
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   if(minLot > 0 && lot < minLot)
      lot = minLot;
   if(maxLot > 0 && lot > maxLot)
      lot = maxLot;

   if(stepLot > 0)
   {
      lot = MathFloor((lot - minLot) / stepLot + 0.0000001) * stepLot + minLot;
      int digits = (int)MathCeil(-MathLog10(stepLot));
      if(digits < 0) digits = 0;
      return NormalizeDouble(lot, digits);
   }

   return NormalizeDouble(lot, 2);
}

//+------------------------------------------------------------------+
//| Obtiene el lotaje segun la configuracion y el indice Crash:      |
//| Auto: 1.00 en Crash 300, 500, 1000 | 0.50 en Crash 600, 900       |
//| Manual: usa TradeLotSize si AutoLotBySymbol es false             |
//+------------------------------------------------------------------+
double GetLotSizeForSymbol()
{
   // Si el usuario desactivo AutoLot y configuro un lote manual
   if(!AutoLotBySymbol && TradeLotSize > 0)
      return NormalizeLotSize(TradeLotSize);

   string sym = _Symbol;
   StringToUpper(sym);

   double lot = 0.50; // Valor base

   // Crash 300, 500, 1000 -> 1.00 lote por defecto
   if(StringFind(sym, "300") >= 0 || StringFind(sym, "500") >= 0 || StringFind(sym, "1000") >= 0 ||
      StringFind(sym, "C3") >= 0  || StringFind(sym, "C5") >= 0  || StringFind(sym, "C10") >= 0)
   {
      lot = 1.00;
   }
   // Crash 600, 900 -> 0.50 lote por defecto
   else if(StringFind(sym, "600") >= 0 || StringFind(sym, "900") >= 0 ||
           StringFind(sym, "C6") >= 0  || StringFind(sym, "C9") >= 0)
   {
      lot = 0.50;
   }
   else if(TradeLotSize > 0)
   {
      lot = TradeLotSize;
   }

   return NormalizeLotSize(lot);
}

//+------------------------------------------------------------------+
//| Retorna el umbral minimo en puntos para detectar un spike        |
//+------------------------------------------------------------------+
double GetSpikeThreshold()
{
   if(CustomSpikeDrop > 0)
      return CustomSpikeDrop;

   string sym = _Symbol;
   StringToUpper(sym);

   if(StringFind(sym, "300") >= 0)
      return 2.5;
   if(StringFind(sym, "500") >= 0)
      return 3.0;
   if(StringFind(sym, "1000") >= 0)
      return 4.0;
   if(StringFind(sym, "600") >= 0 || StringFind(sym, "900") >= 0)
      return 2.5;

   return 3.0;
}

//+------------------------------------------------------------------+
//| Monitorea la posicion abierta, detecta spikes y aplica el tiempo |
//| de 5 minutos (1 vela M5): si no hay nuevo spike, cierra operacion |
//+------------------------------------------------------------------+
void ManageOpenPositionAndSpikes()
{
   // Buscar la posicion abierta de este EA en este simbolo
   ulong currentTicket = 0;
   double openPrice = 0.0;
   double currentProfit = 0.0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            PositionGetInteger(POSITION_MAGIC) == MagicNumber)
         {
            currentTicket = ticket;
            openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            currentProfit = PositionGetDouble(POSITION_PROFIT);
            break;
         }
      }
   }

   // Si NO hay posicion abierta en este momento:
   if(currentTicket == 0)
   {
      if(g_activeTicket != 0)
      {
         g_lastCloseTime = TimeCurrent();
         g_activeTicket = 0;
      }
      g_spikeDetected    = false;
      g_lastSpikeTime    = 0;
      g_positionOpenTime = 0;
      g_lastTrackedBid   = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      return;
   }

   // Si SI hay posicion abierta:
   g_activeTicket = currentTicket;
   if(g_positionOpenTime <= 0)
   {
      datetime posTime = (datetime)PositionGetInteger(POSITION_TIME);
      g_positionOpenTime = (posTime > 0) ? posTime : TimeCurrent();
   }

   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(currentBid <= 0)
      return;

   if(g_lastTrackedBid <= 0)
   {
      g_lastTrackedBid = currentBid;
      return;
   }

   double spikeThreshold = GetSpikeThreshold();

   // Deteccion de Spike (caida brusca en tick o vela M1):
   bool isSpike = false;
   if((g_lastTrackedBid - currentBid) >= spikeThreshold)
      isSpike = true;

   double m1Drop = iOpen(_Symbol, PERIOD_M1, 0) - iLow(_Symbol, PERIOD_M1, 0);
   if(m1Drop >= spikeThreshold && currentBid < openPrice)
      isSpike = true;

   // Si ocurre un spike:
   if(isSpike)
   {
      g_lastSpikeTime = TimeCurrent();
      if(!g_spikeDetected)
      {
         g_spikeDetected = true;
         Print(StringFormat("¡Spike detectado en %s! Iniciando espera de 5 min (1 vela M5)...", _Symbol));
         if(EnableTradeAlerts)
            Alert(StringFormat("¡Spike en %s! Esperando 1 vela de 5 min por si hay nuevo spike.", _Symbol));
      }
      else
      {
         Print(StringFormat("¡Nuevo Spike en %s! Se reinician los 5 minutos de espera.", _Symbol));
      }
   }

   // 0. CONTROL DE STOP LOSS EN USD: Si la perdida alcanza -3 USD (MaxLossUSD), cerrar inmediatamente
   if(MaxLossUSD > 0.0 && currentProfit <= -MaxLossUSD)
   {
      Print(StringFormat("Stop Loss monetario alcanzado en %s: Profit %.2f USD (limite -%.2f USD). Cerrando operacion.",
                         _Symbol, currentProfit, MaxLossUSD));

      if(trade.PositionClose(currentTicket))
      {
         g_lossHour         = iTime(_Symbol, PERIOD_H1, 0); // Bloquear reentradas en esta hora
         g_lastCloseTime    = TimeCurrent();
         g_activeTicket     = 0;
         g_spikeDetected    = false;
         g_lastSpikeTime    = 0;
         g_positionOpenTime = 0;

         if(EnableTradeAlerts)
         {
            Alert(StringFormat("SL Monetario: Operacion en %s cerrada con perdida de %.2f USD (limite: -%.2f USD).",
                               _Symbol, currentProfit, MaxLossUSD));
         }
         return;
      }
   }

   // 1. Si NO ha habido ningun spike: evaluar tras 15 minutos (MaxMinutesWithoutSpike)
   if(!g_spikeDetected && MaxMinutesWithoutSpike > 0 && g_positionOpenTime > 0)
   {
      int elapsedNoSpike = (int)(TimeCurrent() - g_positionOpenTime);
      int maxSec = MaxMinutesWithoutSpike * 60;

      if(elapsedNoSpike >= maxSec)
      {
         // REGLA: Si esta en profit pero menos a 3 USD, NO cerrar, dejar correr
         if(currentProfit >= 0.0 && currentProfit < MinProfitUSD)
         {
            // Dejar correr a la espera de spike
         }
         else if(currentProfit >= MinProfitUSD)
         {
            Print(StringFormat("15 min transcurridos en %s con profit de %.2f USD (>= %.2f USD). Cerrando en ganancia.",
                               _Symbol, currentProfit, MinProfitUSD));

            if(trade.PositionClose(currentTicket))
            {
               g_lastCloseTime    = TimeCurrent();
               g_activeTicket     = 0;
               g_spikeDetected    = false;
               g_lastSpikeTime    = 0;
               g_positionOpenTime = 0;

               if(EnableTradeAlerts)
               {
                  Alert(StringFormat("Take Profit: Operacion en %s cerrada con profit de %.2f USD.", _Symbol, currentProfit));
               }
               return;
            }
         }
      }
   }

   // 2. Si ya hubo spike, esperar 1 vela de 5 minutos (300 seg) por si hay nuevo spike
   if(ManageSpikeExit && g_spikeDetected && g_lastSpikeTime > 0)
   {
      int elapsed = (int)(TimeCurrent() - g_lastSpikeTime);

      // Si pasaron los 5 minutos y no hubo nuevo spike:
      if(elapsed >= WaitSecondsAfterSpike)
      {
         // REGLA: Si esta en profit pero menor a 3 USD, NO cerrar, dejar correr
         if(currentProfit >= 0.0 && currentProfit < MinProfitUSD)
         {
            // Dejar correr esperando otro spike o mayor ganancia
         }
         else if(currentProfit >= MinProfitUSD)
         {
            Print(StringFormat("5 minutos tras spike cumplidos en %s con profit de %.2f USD (>= %.2f USD). Cerrando en ganancia.",
                               _Symbol, currentProfit, MinProfitUSD));

            if(trade.PositionClose(currentTicket))
            {
               g_lastCloseTime    = TimeCurrent();
               g_activeTicket     = 0;
               g_spikeDetected    = false;
               g_lastSpikeTime    = 0;
               g_positionOpenTime = 0;

               if(EnableTradeAlerts)
               {
                  Alert(StringFormat("Take Profit: Operacion cerrada tras spike en %s con %.2f USD.", _Symbol, currentProfit));
               }
               return;
            }
         }
      }
   }

   g_lastTrackedBid = currentBid;
}

//+------------------------------------------------------------------+
//| Verifica si la senal llego al rectangulo o continuacion y opera  |
//+------------------------------------------------------------------+
void CheckTradeEntry()
{
   if(!EnableAutoTrading || !g_autoTradeActive)
      return;

   // Regla estricta: UNA SOLA entrada concurrente por indice
   if(CountOpenPositions() > 0)
      return;

   // Pausa breve tras cerrar antes de buscar otra oportunidad
   if(g_lastCloseTime > 0 && (TimeCurrent() - g_lastCloseTime) < CooldownAfterClose)
      return;

   datetime currentH1 = iTime(_Symbol, PERIOD_H1, 0);

   // Opcional: solo si se desea limitar a 1 por hora
   if(OneTradePerHour && currentH1 == g_lastTradeHour)
      return;

   // Filtro 4: Anti-Racha (Bloquear reentradas en la misma hora H1 tras perdida)
   if(BlockReentryOnLoss && g_lossHour > 0 && g_lossHour == currentH1)
      return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(bid <= 0)
      return;

   bool isBoxEntry   = false;
   bool isTrendEntry = false;
   string entryType  = "";

   // ==============================================================
   // CASO A: SWITCH "SOLO ESTRATEGIA" ACTIVADO (g_onlyStrategy == true)
   // ==============================================================
   // Solo entra cuando el precio toca el rectangulo morado del patron V.
   // NO evalua EMA, NO evalua RSI, NO evalua velas M1, NO evalua continuacion.
   if(g_onlyStrategy)
   {
      if(g_rectActive && g_rectPriceLow > 0 && g_rectPriceHigh > g_rectPriceLow)
      {
         if(bid >= g_rectPriceLow && bid < g_rectPriceHigh)
         {
            isBoxEntry = true;
            entryType  = "Solo Estrategia (Caja V)";
         }
      }
   }
   // ==============================================================
   // CASO B: SWITCH EN OFF -> EVALUA TODO LO DEMAS
   // ==============================================================
   else
   {
      // --- MODO 1: Entrada en el Rectangulo con filtros adicionales ---
      if(g_rectActive && g_rectPriceLow > 0 && g_rectPriceHigh > g_rectPriceLow)
      {
         if(bid >= g_rectPriceLow && bid < g_rectPriceHigh)
         {
            bool trendOk = IsTrendBearish();
            double currentRsi = 0.0;
            bool rsiOk   = IsRsiOverbought(currentRsi);
            int greenM1  = GetConsecutiveGreenM1();
            bool greenOk = (!UseConsecutiveM1Filter || greenM1 >= MinConsecutiveGreenM1);

            if(trendOk && rsiOk && greenOk)
            {
               isBoxEntry = true;
               entryType  = "Zona Rectangulo (+Filtros)";
            }
         }
      }

      // --- MODO 2: Continuacion de Tendencia Bajista (Opcion B fuera de caja) ---
      if(!isBoxEntry && EnableTrendContinuation)
      {
         if(g_trendContTradesInHour < MaxTradesPerH1Trend)
         {
            double h1Close = iClose(_Symbol, PERIOD_H1, 1);
            bool h1Ok    = (!RequireBelowH1Line || (h1Close > 0 && bid < h1Close));
            bool trendOk = IsTrendBearish(); // Precio bajo la EMA de tendencia

            if(h1Ok && trendOk)
            {
               int greenM1 = GetConsecutiveGreenM1();
               if(greenM1 >= TrendContinuationGreenBars)
               {
                  isTrendEntry = true;
                  entryType    = StringFormat("Continuacion Tendencia (%d velas M1)", greenM1);
               }
            }
         }
      }
   }

   // Si hay senal por alguno de los dos modos -> Ejecutar SELL
   if(isBoxEntry || isTrendEntry)
   {
      double lot = GetLotSizeForSymbol();

      trade.SetDeviationInPoints(SlippagePoints);
      trade.SetTypeFillingBySymbol(_Symbol);

      double tpPrice = 0.0;
      if(TakeProfitPoints > 0)
      {
         tpPrice = bid - (TakeProfitPoints * _Point);
         tpPrice = NormalizeDouble(tpPrice, _Digits);
      }

      string comment = StringFormat("Crash-V [%s]", isBoxEntry ? "Caja" : "Tendencia");

      // Se ejecuta SELL gestionando salida por USD y tiempo en el EA
      if(trade.Sell(lot, _Symbol, bid, 0.0, tpPrice, comment))
      {
         if(isTrendEntry)
            g_trendContTradesInHour++;

         g_lastTradeHour    = currentH1;
         g_lastTrackedBid   = bid;
         g_spikeDetected    = false;
         g_lastSpikeTime    = 0;
         g_positionOpenTime = TimeCurrent();
         g_activeTicket     = trade.ResultOrder();

         if(EnableTradeAlerts)
         {
            Alert(StringFormat("¡Entrada SELL por %s en %s!\nPrecio: %s\nLote: %s\nSL Monetario: -%.2f USD\nObjetivo: +%.2f USD",
                               entryType, _Symbol, DoubleToString(bid, _Digits),
                               DoubleToString(lot, 2), MaxLossUSD, MinProfitUSD));
         }
         Print(StringFormat("Orden SELL (%s) ejecutada. Ticket: %d, Lot: %s, Precio: %s, SL: -%.2f USD",
                            entryType, trade.ResultOrder(), DoubleToString(lot, 2),
                            DoubleToString(bid, _Digits), MaxLossUSD));
      }
      else
      {
         Print("Error al ejecutar Sell: ", trade.ResultRetcode(), " - ", trade.ResultRetcodeDescription());
      }
   }
}
//+------------------------------------------------------------------+