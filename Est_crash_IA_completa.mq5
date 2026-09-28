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
input ulong           MagicNumber            = 666666;            // Numero magico del EA
input int             SlippagePoints         = 10;                // Desviacion maxima / Slippage
input bool            OneTradePerHour        = false;             // Limitar a 1 operacion por hora (false = permite varias entradas no concurrentes)
input double          TakeProfitPoints       = 0.0;               // Take Profit en puntos (0 = sin TP fijo, gestion por spike / tiempo)
input bool            EnableTradeAlerts      = true;              // Mostrar alerta sonora/visual al entrar o salir
input bool            OnlyUpperHalfOfZone    = true;              // Entrar solo de la mitad de la zona hacia arriba (50% superior)
input double          ZoneEntryRatio         = 0.50;              // Porcentaje de la zona para entrar (0.50 = de la mitad hacia arriba)

input group "=== Gestion de Salidas (USD, Spikes y Tiempo) ==="
input double          MaxLossUSD             = 3.0;               // Stop Loss en USD: cerrar inmediatamente si llega a -3 USD
input bool            NoSlInZone             = true;              // No cerrar el trade mientras el precio este dentro de la zona demarcada
input bool            CloseOnZoneExit        = true;              // Cerrar operacion al alcanzar el SL por encima de la zona
input double          ZoneSlCandlesM5        = 1.0;               // Margen de Stop Loss tras terminar la zona (en velas M5, 1.0 = 1 vela M5)
input bool            CloseAfterM5TimeOutside= true;              // Cerrar si pasan 5 minutos (1 vela M5) fuera de la zona sin spike
input double          ZoneExitBufferPts      = 0.0;               // Margen extra de puntos por encima de la zona (opcional)
input double          MinProfitUSD           = 3.0;               // Ganancia minima en USD para cerrar tras spike (menos de 3 USD deja correr)
input int             MaxMinutesWithoutSpike = 15;                // Minutos maximos sin spike para evaluar salida
input bool            ManageSpikeExit        = true;              // Cerrar operacion tras spike si profit >= 3 USD
input int             WaitSecondsAfterSpike  = 300;               // Tiempo de espera tras spike (300 seg = 1 vela M5)
input double          CustomSpikeDrop        = 0.0;               // Caida minima para considerar spike (0 = auto segun Crash)
input int             CooldownAfterClose     = 15;                // Segundos de pausa tras cerrar antes de buscar otra oportunidad

input group "=== Proteccion Universal de Entrada contra Spikes ==="
input bool            NeverEnterAfterSpike           = true;   // Nunca entrar al final de un spike (aplica a TODOS los modos y zonas)
input int             SpikeCooldownSec               = 180;    // Segundos de espera tras un spike antes de permitir entradas (180 seg = 3 min)
input int             MinGreenCandlesAfterSpike      = 3;      // Velas M1 verdes obligatorias de acumulacion tras un spike antes de entrar
input double          PreExecutionDropLimitPts       = 3.0;    // Caida maxima permitida durante la orden antes de abortar
#define NeverEnterAfterSpikeOutsideZone NeverEnterAfterSpike
#define SpikeOutsideZoneCooldownSec SpikeCooldownSec

input group "=== Filtros de Seguridad y Alta Probabilidad ==="
input bool            ShowDashboard          = true;              // Mostrar monitor de diagnostico en vivo en el grafico
input bool            UseTrendFilter         = true;              // Filtro 1: Tendencia (Solo SELL si precio bajo EMA)
input ENUM_TIMEFRAMES TrendTimeframe         = PERIOD_M15;        // Temporalidad de la EMA (M15 o H1)
input int             TrendEmaPeriod         = 50;                // Periodo de la EMA de tendencia (ej: 50 o 200)
input bool            UseRsiFilter           = true;              // Filtro 2: Sobrecompra RSI (65.0 recomendado para Crash)
input ENUM_TIMEFRAMES RsiTimeframe           = PERIOD_M5;         // Temporalidad del RSI (M5 o M1)
input int             RsiPeriod              = 14;                // Periodo del RSI
input double          RsiMinLevel            = 65.0;              // Nivel minimo de RSI para entrar (65.0 sobrecompra real)
input bool            UseConsecutiveM1Filter = true;              // Filtro 3: Acumulacion (4 velas M1 verdes seguidas)
input int             MinConsecutiveGreenM1  = 4;                 // Velas M1 verdes seguidas sin spike previo
input bool            BlockReentryOnLoss     = true;              // Filtro 4: Anti-Racha (Bloquear reentradas en la misma H1 tras perdida)

input group "=== Filtro de Vela Amiga (H1) ==="
input bool            UseVelaAmigaFilter         = true;              // Filtro Vela Amiga: Bloquear trade si roja previa H1 cerro mas abajo
input int             MaxBarsLookbackAmiga       = 10;                // Barras H1 hacia atras para buscar la vela amiga roja
input bool            CompareBodyMin             = true;              // Comparar base del cuerpo (Close en roja vs min(Open,Close) en terminada)
input bool            ApplyVelaAmigaToStructural = false;             // Aplicar filtro Vela Amiga al Nivel Estructural H1 (false = opera nivel aunque hubo caida previa)

input group "=== Filtro Progresion Cuerpo de Vela (Estrategia 1) ==="
input bool            UseCandleBodyProgFilter        = true;              // Bloquear Estrategia 1 si vela roja no supera a la anterior
input ENUM_TIMEFRAMES CandleProgTimeframe            = PERIOD_H1;         // Temporalidad para evaluar progresion de velas (H1)
input int             CandleProgLookback             = 30;                // Barras hacia atras para escanear la secuencia
input bool            ConsecutiveRedsOnly            = false;             // Solo comparar rojas estrictamente consecutivas (false = evalua contra roja previa)
input int             MaxBarsBetweenReds             = 5;                 // Maximo de barras de separacion entre rojas a comparar
input bool            ApplyProgressionToStructural   = true;              // Bloquear entradas por Nivel Estructural H1
input bool            ApplyProgressionToBox          = true;              // Bloquear entradas por Caja V / Rectangulo
input bool            ApplyProgressionToTrend        = false;             // Bloquear tambien Continuacion de Tendencia (Opcion B)
input bool            MarkFailedCandleOnChart        = true;              // Dibujar marcador magenta 'O' en la vela que no supero
input color           FailedCandleMarkColor          = clrMagenta;        // Color del marcador visual (magenta como en captura)

input group "=== Marcado visual de patrones ==="
input bool            MarkDoubleWickOnChart          = true;              // Marcar en fucsia el patron de dos velas con mecha
input color           DoubleWickMarkColor            = clrMagenta;        // Color del marcador del patron de dos velas

input group "=== Evaluacion Velas Espejo H1 ==="
input bool            UseH1MirrorCandles         = true;              // Evaluar velas espejo en temporalidad H1 (como en grafica)
input int             H1MirrorBarsLookback       = 200;               // Cantidad de velas H1 hacia atras para buscar velas espejo
input double          H1MirrorTolerancePts       = 10.0;              // Tolerancia en puntos para coincidencia de nivel espejo

input group "=== Operativa Nivel Estructural Horizontal H1 ==="
input bool            UseH1StructuralLevel       = true;              // Activar entradas por llegada a nivel horizontal H1
input int             H1StructuralBarsLookback   = 300;               // Velas H1 hacia atras para buscar el nivel
input double          H1StructuralTolerancePts   = 6.0;               // Tolerancia en puntos para considerar que llego al nivel (6.0 = preciso)
input double          H1StructuralMinDropPts     = 100.0;             // Caida minima que debio tener el precio tras ese nivel en el pasado
input color           H1StructuralLineColor      = clrDarkTurquoise;  // Color de la linea horizontal estructural (cian)
input int             H1StructuralLineWidth      = 2;                 // Grosor de la linea horizontal

input group "=== Continuacion de Tendencia Bajista (Opcion B) ==="
input bool            EnableTrendContinuation    = true;              // Activar entradas por continuacion de tendencia (fuera de caja)
input int             TrendContinuationGreenBars = 4;                 // Velas verdes M1 de retroceso real para entrar (ej: 4 a 6)

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
string   g_activeTradeType      = "";
double   g_activeTradeZoneLow   = 0.0;
double   g_activeTradeZoneHigh  = 0.0;
datetime g_zoneExitTime         = 0;

// Handles para indicadores tecnicos
int      g_emaHandle            = INVALID_HANDLE;
int      g_rsiHandle            = INVALID_HANDLE;
int      g_trendContTradesInHour= 0;

// Variables de estado para Vela Amiga y Velas Espejo H1
bool     g_velaAmigaBlocked      = false;
string   g_velaAmigaReason       = "Inicializando...";
bool     g_h1MirrorFound         = false;
double   g_h1MirrorPrice         = 0.0;
datetime g_h1MirrorCandleTime    = 0;
int      g_h1MirrorBar           = -1;

// Variables para Nivel Estructural Horizontal H1
string   H1StructuralLineName    = "H1_Structural_Level_Line";
string   H1StructuralLabelName   = "H1_Structural_Level_Label";
bool     g_h1StructuralActive    = false;
double   g_h1StructuralPrice     = 0.0;
int      g_h1StructuralBar       = -1;
datetime g_h1StructuralTime      = 0;

// Variables para proteccion universal contra spikes
double   g_lastPreTradeBid        = 0.0;
datetime g_lastSpikeTimestamp     = 0;
bool     g_spikeBlocked           = false;
#define g_spikeOutsideZoneActive g_spikeBlocked

// Variables para Filtro Progresion Cuerpo de Vela H1 (Estrategia 1)
string   CandleProgMarkerName       = "H1_CandleProg_Failed_Marker";
string   DoubleWickMarkerName       = "DoubleWick_Pattern_Marker";
bool     g_candleProgressionBlocked = false;
string   g_candleProgressionReason  = "Inicializando...";
int      g_candleProgFailedBar      = -1;
datetime g_candleProgFailedTime     = 0;

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
bool CheckVelaAmigaH1();
bool CheckCandleProgressionH1();
bool EvaluateH1MirrorCandles(double refPrice, VCandidate &outCandidate);
void UpdateH1StructuralLevel();
bool IsRecentSpikeActive(double currentBid);
#define IsRecentSpikeOutsideZone IsRecentSpikeActive

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
   ObjectDelete(0, H1StructuralLineName);
   ObjectDelete(0, H1StructuralLabelName);
   ObjectDelete(0, CandleProgMarkerName);
   g_realtimeBoxStartTime = 0;
   g_rectActive           = false;
   g_h1StructuralActive   = false;
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
            else if(NeverEnterAfterSpike && g_spikeBlocked)
            {
               int elapsed = (g_lastSpikeTimestamp > 0) ? (int)(TimeCurrent() - g_lastSpikeTimestamp) : 0;
               int remain = MathMax(0, SpikeCooldownSec - elapsed);
               if(remain > 0)
                  tradeText = StringFormat("Spike:%ds", remain);
               else if(currentBid < iOpen(_Symbol, PERIOD_M1, 0))
                  tradeText = "Vela M1 Roja";
               else
                  tradeText = StringFormat("Acum: %d/%dv", GetConsecutiveGreenM1(), MinGreenCandlesAfterSpike);
               ObjectSetInteger(0, BtnTradeName, OBJPROP_BGCOLOR, C'90,50,15');
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
   UpdateH1StructuralLevel();
   ManageOpenPositionAndSpikes();
   CheckTradeEntry();
   CheckDoubleWickPatternOnChart();
   UpdateChartComment();
}

//+------------------------------------------------------------------+
//| Cada segundo: actualiza estado y temporizador de spikes          |
//+------------------------------------------------------------------+
void OnTimer()
{
   CheckNewH1Bar();
   UpdateRealtimeBox();
   UpdateH1StructuralLevel();
   ManageOpenPositionAndSpikes();
   CheckTradeEntry();
   CheckDoubleWickPatternOnChart();
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
   CheckVelaAmigaH1();
   CheckCandleProgressionH1();
   UpdateH1StructuralLevel();
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

   // 1. Evaluacion de Velas Espejo en H1 (prioridad si esta activado)
   bool mirrorMatched = false;
   if(UseH1MirrorCandles)
   {
      VCandidate mirrorCandidate;
      if(EvaluateH1MirrorCandles(h1Price, mirrorCandidate))
      {
         ArrayResize(candidates, 1);
         candidates[0] = mirrorCandidate;
         candCount = 1;
         mirrorMatched = true;
      }
   }

   // 2. Si no se encontro vela espejo en H1, escaneamos segun V_Timeframe (M5)
   if(!mirrorMatched)
   {
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

      // Ordenamos los candidatos por menor distancia a la linea azul (el mas cercano primero)
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
   }

   // 3. Dibujamos SOLO UNA linea morada en el punto MAS CERCANO a la linea azul
   if(candCount > 0)
   {
      DrawVLine(candidates[0].vLinePrice, candidates[0].distToBlue);
   }

   // 4. Marcamos UNICAMENTE UN SOLO PUNTO (el mas cercano a la linea azul o espejo H1)
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
      if(mirrorMatched)
      {
         if(ObjectFind(0, arrowName) < 0)
         {
            ObjectCreate(0, arrowName, OBJ_TEXT, 0, candidates[0].timeCenter, candidates[0].priceLow);
            ObjectSetInteger(0, arrowName, OBJPROP_COLOR, V_BoxColor);
            ObjectSetInteger(0, arrowName, OBJPROP_FONTSIZE, 10);
            ObjectSetInteger(0, arrowName, OBJPROP_ANCHOR, ANCHOR_TOP);
            ObjectSetInteger(0, arrowName, OBJPROP_SELECTABLE, false);
            ObjectSetString(0, arrowName, OBJPROP_TEXT, StringFormat("▲ Espejo H1 (bar %d)", candidates[0].redBar));
         }
         else
         {
            ObjectMove(0, arrowName, 0, candidates[0].timeCenter, candidates[0].priceLow);
            ObjectSetString(0, arrowName, OBJPROP_TEXT, StringFormat("▲ Espejo H1 (bar %d)", candidates[0].redBar));
         }
      }
      else
      {
         DrawVIndicator(arrowName, candidates[0].timeCenter, candidates[0].priceLow, 1);
      }
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
//| En Crash: Si la vela actual esta cayendo o hubo spike, retorna 0 |
//+------------------------------------------------------------------+
int GetConsecutiveGreenM1()
{
   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double o0 = iOpen(_Symbol, PERIOD_M1, 0);
   double l0 = iLow(_Symbol, PERIOD_M1, 0);
   double spikeTh = GetSpikeThreshold();

   // Si la vela M1 actual (barra 0) esta cayendo en rojo o tuvo un spike, no hay acumulacion
   if(o0 > 0 && (currentBid < o0 || (o0 - l0) >= spikeTh))
      return 0;

   int count = 0;
   int total = iBars(_Symbol, PERIOD_M1);
   int limit = MathMin(50, total - 1);

   for(int i = 1; i <= limit; i++)
   {
      double o = iOpen(_Symbol, PERIOD_M1, i);
      double c = iClose(_Symbol, PERIOD_M1, i);
      double l = iLow(_Symbol, PERIOD_M1, i);

      // Si la vela cerro por debajo de la apertura (vela roja / spike) o tuvo una caida tipo spike
      if(c < o || (o - l) >= spikeTh)
         break;

      count++;
   }

   return count;
}

//+------------------------------------------------------------------+
//| Filtro Vela Amiga H1:                                             |
//| Al terminar la vela H1 (barra 1), busca la vela roja previa      |
//| ("vela amiga", spike bajista en Crash). Si el cuerpo de esa      |
//| vela roja cerro mas abajo que el cuerpo de la vela terminada,    |
//| se bloquea la operativa (NO HACER TRADE).                        |
//+------------------------------------------------------------------+
bool CheckVelaAmigaH1()
{
   if(!UseVelaAmigaFilter)
   {
      g_velaAmigaBlocked = false;
      g_velaAmigaReason  = "Filtro Desactivado";
      return true;
   }

   // Vela que termino (barra 1 en H1)
   double open1  = iOpen(_Symbol, PERIOD_H1, 1);
   double close1 = iClose(_Symbol, PERIOD_H1, 1);
   if(open1 <= 0 || close1 <= 0)
   {
      g_velaAmigaBlocked = false;
      g_velaAmigaReason  = "Esperando datos H1...";
      return true;
   }

   // Nivel de cuerpo de la vela que termino:
   // Si CompareBodyMin = true: base del cuerpo (minimo entre Open y Close)
   // Si CompareBodyMin = false: Close de la vela que termino
   double bodyBottomTermino = CompareBodyMin ? MathMin(open1, close1) : close1;

   // Buscar la vela amiga (la roja previa en H1)
   // Comenzamos en la barra 2 (antes de la que termino) hasta MaxBarsLookbackAmiga
   int amigaBar = -1;
   int lookback = MathMax(3, MaxBarsLookbackAmiga);
   int totalH1  = iBars(_Symbol, PERIOD_H1);
   int limit    = MathMin(lookback, totalH1 - 1);

   for(int b = 2; b <= limit; b++)
   {
      double o = iOpen(_Symbol, PERIOD_H1, b);
      double c = iClose(_Symbol, PERIOD_H1, b);
      if(c < o) // Vela bajista / roja en Crash
      {
         amigaBar = b;
         break;
      }
   }

   if(amigaBar > 0)
   {
      // En una vela roja bajista, la base del cuerpo es el Close
      double bodyBottomAmiga = iClose(_Symbol, PERIOD_H1, amigaBar);

      // Regla: si el cuerpo de la vela amiga (roja) esta mas abajo del cuerpo de la que termino -> NO HACER TRADE
      if(bodyBottomAmiga < bodyBottomTermino)
      {
         g_velaAmigaBlocked = true;
         g_velaAmigaReason  = StringFormat("BLOQUEADO (Roja H1 bar %d: %.*f < terminada: %.*f)",
                                           amigaBar, _Digits, bodyBottomAmiga, _Digits, bodyBottomTermino);
         return false; // Bloquea trade
      }
      else
      {
         g_velaAmigaBlocked = false;
         g_velaAmigaReason  = StringFormat("OK (Roja H1 bar %d: %.*f >= terminada: %.*f)",
                                           amigaBar, _Digits, bodyBottomAmiga, _Digits, bodyBottomTermino);
         return true; // Seguro para operar
      }
   }

   // Si no se encontro ninguna vela roja previa en el rango
   g_velaAmigaBlocked = false;
   g_velaAmigaReason  = "OK (Sin roja previa cercana)";
   return true;
}

//+------------------------------------------------------------------+
//| Filtro Progresion de Cuerpo de Vela H1 (Estrategia 1):           |
//| Si una vela roja no supera a la anterior del mismo color         |
//| (Close >= Close anterior de la roja previa), se bloquean las     |
//| entradas de Estrategia 1 (Caja V y Nivel Estructural) hasta que  |
//| no se de lo contrario: es decir, nuevamente roja y otra que      |
//| queda mas bajo.                                                  |
//+------------------------------------------------------------------+
bool CheckCandleProgressionH1()
{
   if(!UseCandleBodyProgFilter)
   {
      g_candleProgressionBlocked = false;
      g_candleProgressionReason  = "Filtro Desactivado";
      ObjectDelete(0, CandleProgMarkerName);
      return true;
   }

   ENUM_TIMEFRAMES tf = CandleProgTimeframe;
   int totalBars = iBars(_Symbol, tf);
   int lookback = MathMin(CandleProgLookback, totalBars - 2);
   if(lookback < 2)
   {
      g_candleProgressionBlocked = false;
      g_candleProgressionReason  = "Esperando datos...";
      ObjectDelete(0, CandleProgMarkerName);
      return true;
   }

   int lastRedBar = -1;
   double lastRedClose = 0.0;
   bool isBlocked = false;
   string blockReason = "OK (Secuencia bajista limpia)";
   int failedBar = -1;
   datetime failedTime = 0;
   double failedLow = 0.0;

   // Escaneamos cronologicamente de la barra mas antigua a la mas reciente (lookback down to 1)
   for(int b = lookback; b >= 1; b--)
   {
      double o = iOpen(_Symbol, tf, b);
      double c = iClose(_Symbol, tf, b);
      double l = iLow(_Symbol, tf, b);

      if(c < o) // Es vela roja / bajista en Crash
      {
         double currentRedClose = c;

         if(lastRedBar != -1)
         {
            int barDistance = lastRedBar - b; // Distancia en barras entre las dos rojas
            bool distanceOk = (!ConsecutiveRedsOnly || barDistance == 1);
            if(!ConsecutiveRedsOnly && MaxBarsBetweenReds > 0 && barDistance > MaxBarsBetweenReds)
               distanceOk = false;

            if(distanceOk)
            {
               // Verificamos si la roja actual supero a la anterior del mismo color:
               // "Superar" = que quede mas bajo (Close actual < Close anterior)
               if(currentRedClose < lastRedClose)
               {
                  // Se da lo contrario: nuevamente roja y otra que queda mas bajo
                  isBlocked = false;
                  blockReason = StringFormat("OK (Roja bar %d [%.*f] supero a bar %d [%.*f])",
                                             b, _Digits, currentRedClose, lastRedBar, _Digits, lastRedClose);
                  failedBar = -1;
                  failedTime = 0;
               }
               else
               {
                  // Su cuerpo NO supero a la anterior del mismo color (Close >= Close anterior)
                  isBlocked = true;
                  failedBar = b;
                  failedTime = iTime(_Symbol, tf, b);
                  failedLow = l;
                  blockReason = StringFormat("BLOQUEADO (Roja bar %d [%.*f] NO supero a bar %d [%.*f])",
                                             b, _Digits, currentRedClose, lastRedBar, _Digits, lastRedClose);
               }
            }
         }

         // Actualizamos la ultima vela roja vista
         lastRedBar = b;
         lastRedClose = currentRedClose;
      }
   }

   g_candleProgressionBlocked = isBlocked;
   g_candleProgressionReason  = blockReason;
   g_candleProgFailedBar      = failedBar;
   g_candleProgFailedTime     = failedTime;

   // Marcador visual magenta en la vela que no supero
   if(MarkFailedCandleOnChart && isBlocked && failedTime > 0)
   {
      if(ObjectFind(0, CandleProgMarkerName) < 0)
      {
         ObjectCreate(0, CandleProgMarkerName, OBJ_TEXT, 0, failedTime, failedLow);
         ObjectSetInteger(0, CandleProgMarkerName, OBJPROP_COLOR, FailedCandleMarkColor);
         ObjectSetInteger(0, CandleProgMarkerName, OBJPROP_FONTSIZE, 12);
         ObjectSetInteger(0, CandleProgMarkerName, OBJPROP_ANCHOR, ANCHOR_TOP);
         ObjectSetInteger(0, CandleProgMarkerName, OBJPROP_SELECTABLE, false);
      }
      else
      {
         ObjectMove(0, CandleProgMarkerName, 0, failedTime, failedLow);
      }
      ObjectSetString(0, CandleProgMarkerName, OBJPROP_TEXT, "O [No supero]");
      ObjectSetString(0, CandleProgMarkerName, OBJPROP_TOOLTIP, StringFormat("Vela roja (bar %d) no supero en cuerpo a la anterior", failedBar));
   }
   else
   {
      ObjectDelete(0, CandleProgMarkerName);
   }

   return !isBlocked;
}

//+------------------------------------------------------------------+
//| Marcador visual magenta/fucsia para patron de dos velas con mecha |
//+------------------------------------------------------------------+
void CheckDoubleWickPatternOnChart()
{
   if(!MarkDoubleWickOnChart)
   {
      ObjectDelete(0, DoubleWickMarkerName);
      return;
   }

   double o1 = iOpen(_Symbol, PERIOD_M5, 1);
   double c1 = iClose(_Symbol, PERIOD_M5, 1);
   double h1 = iHigh(_Symbol, PERIOD_M5, 1);
   double l1 = iLow(_Symbol, PERIOD_M5, 1);
   double o0 = iOpen(_Symbol, PERIOD_M5, 0);
   double c0 = iClose(_Symbol, PERIOD_M5, 0);
   double h0 = iHigh(_Symbol, PERIOD_M5, 0);
   double l0 = iLow(_Symbol, PERIOD_M5, 0);

   bool candle1Ok = false;
   bool candle0Ok = false;

   if(o1 > 0 && h1 > 0 && l1 > 0)
   {
      double body1 = MathAbs(c1 - o1);
      double upper1 = h1 - MathMax(o1, c1);
      double lower1 = MathMin(o1, c1) - l1;
      if(body1 > 0)
      {
         double minW1 = body1 * 0.25;
         double maxW1 = body1 * 2.2;
         candle1Ok = (upper1 >= minW1 && lower1 >= minW1 && upper1 <= maxW1 && lower1 <= maxW1);
      }
   }

   if(o0 > 0 && h0 > 0 && l0 > 0)
   {
      double body0 = MathAbs(c0 - o0);
      double upper0 = h0 - MathMax(o0, c0);
      double lower0 = MathMin(o0, c0) - l0;
      if(body0 > 0)
      {
         double minW0 = body0 * 0.25;
         double maxW0 = body0 * 2.2;
         candle0Ok = (upper0 >= minW0 && lower0 >= minW0 && upper0 <= maxW0 && lower0 <= maxW0);
      }
   }

   bool validPattern = candle1Ok && candle0Ok &&
      ((c1 > o1 && c0 > o0 && c0 > c1 && h0 > h1 && l0 > l1) ||
       (c1 < o1 && c0 < o0 && c0 < c1 && h0 < h1 && l0 < l1));

   if(validPattern)
   {
      datetime markerTime = iTime(_Symbol, PERIOD_M5, 1);
      double markerPrice = MathMin(l1, l0);
      if(markerTime <= 0)
         return;

      if(ObjectFind(0, DoubleWickMarkerName) < 0)
      {
         ObjectCreate(0, DoubleWickMarkerName, OBJ_TEXT, 0, markerTime, markerPrice);
         ObjectSetInteger(0, DoubleWickMarkerName, OBJPROP_COLOR, DoubleWickMarkColor);
         ObjectSetInteger(0, DoubleWickMarkerName, OBJPROP_FONTSIZE, 12);
         ObjectSetInteger(0, DoubleWickMarkerName, OBJPROP_ANCHOR, ANCHOR_TOP);
         ObjectSetInteger(0, DoubleWickMarkerName, OBJPROP_SELECTABLE, false);
      }
      else
      {
         ObjectMove(0, DoubleWickMarkerName, 0, markerTime, markerPrice);
      }
      ObjectSetString(0, DoubleWickMarkerName, OBJPROP_TEXT, "2 VELAS");
      ObjectSetString(0, DoubleWickMarkerName, OBJPROP_TOOLTIP, "Patron de dos velas con mecha (fucsia)");
   }
   else
   {
      ObjectDelete(0, DoubleWickMarkerName);
   }
}

//+------------------------------------------------------------------+
//| Evaluacion de Velas Espejo en H1:                                |
//| Busca en el historial de H1 velas rojas cuyo nivel de soporte    |
//| coincida a modo de espejo con el cierre o base de la vela actual |
//+------------------------------------------------------------------+
bool EvaluateH1MirrorCandles(double refPrice, VCandidate &outCandidate)
{
   if(!UseH1MirrorCandles || refPrice <= 0)
   {
      g_h1MirrorFound = false;
      return false;
   }

   int totalH1 = iBars(_Symbol, PERIOD_H1);
   int limit = MathMin(H1MirrorBarsLookback, totalH1 - 2);
   if(limit < 5)
   {
      g_h1MirrorFound = false;
      return false;
   }

   double tolVal = DistanceInPoints ? (H1MirrorTolerancePts * _Point) : H1MirrorTolerancePts;
   double bestDiff = DBL_MAX;
   int bestBar = -1;
   double bestPrice = 0.0;

   // Escaneamos desde la barra 2 hacia atras en H1
   for(int k = 2; k < limit; k++)
   {
      double o = iOpen(_Symbol, PERIOD_H1, k);
      double c = iClose(_Symbol, PERIOD_H1, k);
      double l = iLow(_Symbol, PERIOD_H1, k);

      // Buscamos velas rojas en H1 (reaccion bajista previa / soporte espejo)
      if(c >= o)
         continue;

      double candPrice = (V_LinePriceMode == V_LINE_PRICE_CLOSE) ? c : l;

      // REGLA ESTRICTA: La vela espejo DEBE estar estrictamente por encima o sobre la linea azul
      if(candPrice < refPrice)
         continue;

      double diff = candPrice - refPrice;

      // Verificamos si esta dentro de la tolerancia de espejo
      if(diff <= tolVal)
      {
         if(diff < bestDiff)
         {
            bestDiff  = diff;
            bestBar   = k;
            bestPrice = candPrice;
         }
      }
   }

   if(bestBar > 0)
   {
      outCandidate.redBar     = bestBar;
      outCandidate.timeStart  = iTime(_Symbol, PERIOD_H1, bestBar);
      outCandidate.timeCenter = outCandidate.timeStart;
      outCandidate.timeEnd    = outCandidate.timeStart + PeriodSeconds(PERIOD_H1);
      outCandidate.priceHigh  = iHigh(_Symbol, PERIOD_H1, bestBar);
      outCandidate.priceLow   = iLow(_Symbol, PERIOD_H1, bestBar);
      outCandidate.vLinePrice = bestPrice;
      outCandidate.distToBlue = bestDiff;

      g_h1MirrorFound      = true;
      g_h1MirrorPrice      = bestPrice;
      g_h1MirrorCandleTime = outCandidate.timeStart;
      g_h1MirrorBar        = bestBar;
      return true;
   }

   g_h1MirrorFound = false;
   g_h1MirrorBar   = -1;
   return false;
}

//+------------------------------------------------------------------+
//| Dibuja y evalua el nivel horizontal estructural en H1            |
//| Busca techos/picos historicos donde hubo fuerte caida previa     |
//| a los cuales la estructura de precio actual acaba de llegar      |
//+------------------------------------------------------------------+
void UpdateH1StructuralLevel()
{
   if(!UseH1StructuralLevel)
   {
      ObjectDelete(0, H1StructuralLineName);
      ObjectDelete(0, H1StructuralLabelName);
      g_h1StructuralActive = false;
      g_h1StructuralPrice  = 0.0;
      g_h1StructuralBar    = -1;
      return;
   }

   int totalH1 = iBars(_Symbol, PERIOD_H1);
   if(totalH1 < 20)
      return;

   int limit = MathMin(H1StructuralBarsLookback, totalH1 - 5);
   double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(currentBid <= 0)
      currentBid = iClose(_Symbol, PERIOD_H1, 0);

   double tolVal     = DistanceInPoints ? (H1StructuralTolerancePts * _Point) : H1StructuralTolerancePts;
   double minDropVal = DistanceInPoints ? (H1StructuralMinDropPts * _Point) : H1StructuralMinDropPts;

   double   bestLevel = 0.0;
   int      bestBar   = -1;
   double   bestDiff  = DBL_MAX;
   datetime bestTime  = 0;

   // Buscamos picos o niveles de rechazo bajista en H1
   for(int k = 5; k < limit; k++)
   {
      double h = iHigh(_Symbol, PERIOD_H1, k);
      double c = iClose(_Symbol, PERIOD_H1, k);
      double o = iOpen(_Symbol, PERIOD_H1, k);

      // Nivel de techo / cuerpo superior del pico estructural
      double level = (V_LinePriceMode == V_LINE_PRICE_CLOSE) ? MathMax(o, c) : h;

      double h1Close = iClose(_Symbol, PERIOD_H1, 1);
      // REGLA ESTRICTA: El nivel estructural DEBE estar estrictamente por encima o sobre la linea azul
      if(h1Close > 0 && level < h1Close)
         continue;

      // Verificamos si en las siguientes velas hacia la derecha hubo una caida importante
      double minAfter = level;
      int scanForward = MathMin(30, k - 1);
      for(int j = k - scanForward; j < k; j++)
      {
         double lowJ = iLow(_Symbol, PERIOD_H1, j);
         if(lowJ < minAfter)
            minAfter = lowJ;
      }

      double drop = level - minAfter;
      if(drop < minDropVal)
         continue; // No tuvo una caida representativa

      // Diferencia entre el precio actual y este nivel estructural
      double diff = MathAbs(currentBid - level);

      // Si el precio esta dentro o cerca de la zona estructural
      if(diff <= (tolVal * 2.5))
      {
         if(diff < bestDiff)
         {
            bestDiff  = diff;
            bestBar   = k;
            bestLevel = level;
            bestTime  = iTime(_Symbol, PERIOD_H1, k);
         }
      }
   }

   // Si encontramos un nivel estructural coincidente
   if(bestBar > 0 && bestLevel > 0)
   {
      g_h1StructuralActive = true;
      g_h1StructuralPrice  = bestLevel;
      g_h1StructuralBar    = bestBar;
      g_h1StructuralTime   = bestTime;

      // Dibujar o mover linea horizontal cian
      if(ObjectFind(0, H1StructuralLineName) < 0)
      {
         ObjectCreate(0, H1StructuralLineName, OBJ_HLINE, 0, 0, bestLevel);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_COLOR, H1StructuralLineColor);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_WIDTH, H1StructuralLineWidth);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_STYLE, STYLE_SOLID);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_BACK, false);
         ObjectSetString(0, H1StructuralLineName, OBJPROP_TOOLTIP, StringFormat("Nivel Estructural H1 (bar %d): %.*f", bestBar, _Digits, bestLevel));
      }
      else
      {
         ObjectMove(0, H1StructuralLineName, 0, 0, bestLevel);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_COLOR, H1StructuralLineColor);
         ObjectSetInteger(0, H1StructuralLineName, OBJPROP_WIDTH, H1StructuralLineWidth);
         ObjectSetString(0, H1StructuralLineName, OBJPROP_TOOLTIP, StringFormat("Nivel Estructural H1 (bar %d): %.*f", bestBar, _Digits, bestLevel));
      }

      // Etiqueta informativa del nivel estructural
      if(ObjectFind(0, H1StructuralLabelName) < 0)
      {
         ObjectCreate(0, H1StructuralLabelName, OBJ_TEXT, 0, TimeCurrent(), bestLevel);
         ObjectSetInteger(0, H1StructuralLabelName, OBJPROP_COLOR, H1StructuralLineColor);
         ObjectSetInteger(0, H1StructuralLabelName, OBJPROP_FONTSIZE, 9);
         ObjectSetInteger(0, H1StructuralLabelName, OBJPROP_SELECTABLE, false);
      }
      else
      {
         ObjectMove(0, H1StructuralLabelName, 0, TimeCurrent(), bestLevel);
      }
      ObjectSetString(0, H1StructuralLabelName, OBJPROP_TEXT, StringFormat("  Estructural H1 (bar %d): %.*f", bestBar, _Digits, bestLevel));
   }
   else
   {
      // Si el precio se alejo demasiado del nivel estructural anterior
      if(g_h1StructuralPrice > 0 && MathAbs(currentBid - g_h1StructuralPrice) > (tolVal * 4.0))
      {
         ObjectDelete(0, H1StructuralLineName);
         ObjectDelete(0, H1StructuralLabelName);
         g_h1StructuralActive = false;
         g_h1StructuralPrice  = 0.0;
         g_h1StructuralBar    = -1;
      }
   }
}

//+------------------------------------------------------------------+
//| Detecta si hubo un spike reciente o si el mercado esta cayendo   |
//| Regla Universal: NUNCA entrar al final de un spike en NINGUN modo|
//+------------------------------------------------------------------+
bool IsRecentSpikeActive(double currentBid)
{
   if(!NeverEnterAfterSpike)
   {
      g_spikeBlocked = false;
      return false;
   }

   double spikeThreshold = GetSpikeThreshold();
   datetime now = TimeCurrent();

   // 1. Detectar caida brusca en tick
   if(g_lastPreTradeBid > 0)
   {
      double tickDrop = g_lastPreTradeBid - currentBid;
      if(tickDrop >= spikeThreshold)
      {
         g_lastSpikeTimestamp = now;
      }
   }
   g_lastPreTradeBid = currentBid;

   // 2. Detectar caida brusca en vela M1 actual (barra 0)
   double m1Open0 = iOpen(_Symbol, PERIOD_M1, 0);
   double m1Low0  = iLow(_Symbol, PERIOD_M1, 0);
   double m1High0 = iHigh(_Symbol, PERIOD_M1, 0);
   if((m1Open0 - m1Low0) >= spikeThreshold || (m1High0 - currentBid) >= spikeThreshold)
   {
      g_lastSpikeTimestamp = now;
   }

   // 3. Detectar si la vela M1 anterior (barra 1) fue spike o cerro roja
   double m1Open1  = iOpen(_Symbol, PERIOD_M1, 1);
   double m1Close1 = iClose(_Symbol, PERIOD_M1, 1);
   double m1Low1   = iLow(_Symbol, PERIOD_M1, 1);
   if((m1Open1 - m1Low1) >= spikeThreshold || (m1Open1 - m1Close1) >= spikeThreshold || m1Close1 < m1Open1)
   {
      datetime m1Time1 = iTime(_Symbol, PERIOD_M1, 1);
      if((m1Time1 + 60) > g_lastSpikeTimestamp)
         g_lastSpikeTimestamp = m1Time1 + 60;
   }

   // 4. BLOQUEO UNIVERSAL 1: Cooldown de espera obligatoria tras spike (ej: 180 seg)
   if(g_lastSpikeTimestamp > 0 && (now - g_lastSpikeTimestamp) < SpikeCooldownSec)
   {
      g_spikeBlocked = true;
      return true; // BLOQUEADO: Cooldown activo tras spike
   }

   // 5. BLOQUEO UNIVERSAL 2: La vela actual (barra 0) NO puede ser roja
   if(m1Open0 > 0 && currentBid < m1Open0)
   {
      g_spikeBlocked = true;
      return true; // BLOQUEADO: Barra 0 cayendo en rojo
   }

   // 6. BLOQUEO UNIVERSAL 3: Exigir acumulacion minima de velas verdes
   int greenM1 = GetConsecutiveGreenM1();
   if(greenM1 < MinGreenCandlesAfterSpike)
   {
      g_spikeBlocked = true;
      return true; // BLOQUEADO: Acumulacion insuficiente tras spike
   }

   g_spikeBlocked = false;
   return false;
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
      double entryFloor = g_rectPriceLow;
      if(OnlyUpperHalfOfZone && ZoneEntryRatio > 0.0)
         entryFloor = g_rectPriceLow + (g_rectPriceHigh - g_rectPriceLow) * ZoneEntryRatio;

      inBox = (bid >= entryFloor && bid < g_rectPriceHigh);
      if(inBox)
         boxStatus = StringFormat("DENTRO 50%% SUP (%.*f - %.*f) -> ZONA DISPARO ACTIVA", _Digits, entryFloor, _Digits, g_rectPriceHigh);
      else if(bid < g_rectPriceLow)
         boxStatus = StringFormat("DEBAJO (Faltan %.*f pts para zona)", _Digits, g_rectPriceLow - bid);
      else if(bid < entryFloor)
         boxStatus = StringFormat("MITAD INFERIOR (Subiendo: faltan %.*f pts para entrar al 50%%)", _Digits, entryFloor - bid);
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

   // Estado Filtro 5: Vela Amiga H1
   string amigaStr = "Desactivado";
   if(UseVelaAmigaFilter)
   {
      amigaStr = g_velaAmigaBlocked ? "BLOQUEADO (Cuerpo roja previa mas abajo)"
                                    : "OK (Permitido)";
   }

   // Estado Evaluacion Velas Espejo H1
   string mirrorStr = "Modo M5";
   if(UseH1MirrorCandles)
   {
      mirrorStr = g_h1MirrorFound ? StringFormat("DETECTADA (H1 bar %d: %.*f)", g_h1MirrorBar, _Digits, g_h1MirrorPrice)
                                  : "Buscando en H1";
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

   // Estado Operativa Nivel Estructural H1
   string structuralStr = "Desactivado";
   bool inStructuralZone = false;
   if(UseH1StructuralLevel)
   {
      if(g_h1StructuralActive && g_h1StructuralPrice > 0)
      {
         double tol = DistanceInPoints ? (H1StructuralTolerancePts * _Point) : H1StructuralTolerancePts;
         inStructuralZone = (bid >= (g_h1StructuralPrice - tol) && bid <= (g_h1StructuralPrice + tol));
         if(inStructuralZone)
            structuralStr = StringFormat("¡EN ZONA! (%.*f)", _Digits, g_h1StructuralPrice);
         else if(bid < g_h1StructuralPrice)
            structuralStr = StringFormat("A %.*f pts (%.*f)", _Digits, g_h1StructuralPrice - bid, _Digits, g_h1StructuralPrice);
         else
            structuralStr = StringFormat("Paso por %.*f pts (%.*f)", _Digits, bid - g_h1StructuralPrice, _Digits, g_h1StructuralPrice);
      }
      else
      {
         structuralStr = "Buscando nivel...";
      }
   }

   // Estado Anti-Spike Universal
   string antiSpikeStr = "Desactivado";
   if(NeverEnterAfterSpike)
   {
      if(g_spikeBlocked)
      {
         int elapsed = (g_lastSpikeTimestamp > 0) ? (int)(TimeCurrent() - g_lastSpikeTimestamp) : 0;
         int remain = MathMax(0, SpikeCooldownSec - elapsed);
         int greenM1 = GetConsecutiveGreenM1();
         if(remain > 0)
            antiSpikeStr = StringFormat("BLOQUEADO (Cooldown spike: %ds)", remain);
         else if(bid < iOpen(_Symbol, PERIOD_M1, 0))
            antiSpikeStr = "BLOQUEADO (Barra M1 cayendo / roja)";
         else
            antiSpikeStr = StringFormat("BLOQUEADO (Acumulacion: %d/%d velas M1)", greenM1, MinGreenCandlesAfterSpike);
      }
      else
      {
         antiSpikeStr = StringFormat("OK (Acumulacion limpia %dv)", GetConsecutiveGreenM1());
      }
   }

   // Estado Progresion Cuerpo de Vela H1
   string progStr = "Desactivado";
   if(UseCandleBodyProgFilter)
   {
      progStr = g_candleProgressionBlocked
                ? StringFormat("BLOQUEADO (%s)", g_candleProgressionReason)
                : StringFormat("OK (%s)", g_candleProgressionReason);
   }

   // Resumen global
   string generalStatus = "";
   if(CountOpenPositions() > 0)
   {
      if(g_activeTradeType == "Caja" || g_activeTradeType == "Estructural")
      {
         double zHigh    = (g_activeTradeZoneHigh > 0) ? g_activeTradeZoneHigh : g_rectPriceHigh;
         double m5H      = GetM5CandleHeight();
         double slMargin = (m5H * ZoneSlCandlesM5) + (DistanceInPoints ? (ZoneExitBufferPts * _Point) : ZoneExitBufferPts);
         double slPrice  = zHigh + slMargin;

         if(bid <= zHigh)
            generalStatus = StringFormat("OPERACION EN CURSO (En Zona %s | SL en %.*f [+1v M5])", g_activeTradeType, _Digits, slPrice);
         else if(bid <= slPrice)
            generalStatus = StringFormat("OPERACION EN CURSO (Fuera de zona: margen hasta SL %.*f | Restan %.*f pts)", _Digits, slPrice, _Digits, slPrice - bid);
         else
            generalStatus = StringFormat("OPERACION EN CURSO (SL ALCANZADO: Bid %.*f > SL %.*f)", _Digits, bid, _Digits, slPrice);
      }
      else if(inBox && NoSlInZone)
         generalStatus = "OPERACION EN CURSO (En Zona Demarcada: SL pausado esperando spike)";
      else
         generalStatus = "OPERACION EN CURSO (Monitoreando salida)";
   }
   else if(NeverEnterAfterSpike && g_spikeBlocked)
      generalStatus = "BLOQUEADO (Spike reciente: Esperando acumulacion limpia)";
   else if(!rachaOk)
      generalStatus = "PAUSA POR SL EN ESTA H1 (Esperando proxima hora)";
   else if(UseCandleBodyProgFilter && g_candleProgressionBlocked && (inStructuralZone || inBox))
      generalStatus = "BLOQUEADO (Vela roja no supero anterior: No hacer Estrategia 1)";
   else if(inStructuralZone && (!ApplyVelaAmigaToStructural || !g_velaAmigaBlocked))
      generalStatus = "SEÑAL ACTIVA: PRECIO EN NIVEL ESTRUCTURAL H1 -> SELL!";
   else if(UseVelaAmigaFilter && g_velaAmigaBlocked)
      generalStatus = "BLOQUEADO POR VELA AMIGA H1 (Cuerpo roja mas abajo: No hacer trade)";
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
      " [5] Vela Amiga H1:         %s\n" +
      " [6] Velas Espejo H1:       %s\n" +
      " [7] Nivel Estructural H1:  %s\n" +
      " [8] Anti-Spike Fuera Zona: %s\n" +
      " [9] Progresion Cuerpo H1:  %s\n" +
      " [B] Continuacion Tendencia: %s\n" +
      "-------------------------------------------------------\n" +
      " >> ESTADO: %s\n" +
      "=======================================================\n",
      modeStr, boxStatus, _Digits, bid,
      EnumToString(TrendTimeframe), TrendEmaPeriod, trendStr,
      EnumToString(RsiTimeframe), rsiStr,
      greenStr, rachaStr, amigaStr, mirrorStr, structuralStr, antiSpikeStr, progStr, trendContStr, generalStatus
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

   // REGLA ESTRICTA: La zona NUNCA debe estar por debajo de la linea azul
   double h1Price = iClose(_Symbol, PERIOD_H1, 1);
   if(h1Price > 0 && purplePrice < h1Price)
   {
      ObjectDelete(0, RealtimeBoxName);
      g_rectActive = false;
      return;
   }

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
//| Cierra una posicion de forma robusta con reintentos y filling    |
//+------------------------------------------------------------------+
bool ClosePositionRobust(ulong ticket)
{
   if(ticket <= 0)
      return false;

   trade.SetDeviationInPoints(SlippagePoints > 50 ? SlippagePoints : 50);
   trade.SetTypeFillingBySymbol(_Symbol);

   if(trade.PositionClose(ticket))
      return true;

   // Reintento con filling IOC
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   if(trade.PositionClose(ticket))
      return true;

   // Reintento con filling FOK
   trade.SetTypeFilling(ORDER_FILLING_FOK);
   if(trade.PositionClose(ticket))
      return true;

   // Reintento con filling RETURN
   trade.SetTypeFilling(ORDER_FILLING_RETURN);
   if(trade.PositionClose(ticket))
      return true;

   PrintFormat("ERROR CRITICO: PositionClose fallo para ticket %d (RetCode: %d, Descripcion: %s)",
               ticket, trade.ResultRetcode(), trade.ResultRetcodeDescription());
   return false;
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
   string currentComment = "";

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
            currentComment = PositionGetString(POSITION_COMMENT);
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
      g_spikeDetected       = false;
      g_lastSpikeTime       = 0;
      g_positionOpenTime    = 0;
      g_activeTradeType     = "";
      g_activeTradeZoneLow  = 0.0;
      g_activeTradeZoneHigh = 0.0;
      g_zoneExitTime        = 0;
      g_lastTrackedBid      = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      return;
   }

   // Si SI hay posicion abierta:
   g_activeTicket = currentTicket;
   if(g_positionOpenTime <= 0)
   {
      datetime posTime = (datetime)PositionGetInteger(POSITION_TIME);
      g_positionOpenTime = (posTime > 0) ? posTime : TimeCurrent();
   }

   // Reconstruir contexto de la zona si el EA se reinicio con posicion activa
   if(g_activeTradeType == "" || g_activeTradeZoneHigh <= 0.0)
   {
      if(StringFind(currentComment, "Caja") >= 0)
      {
         g_activeTradeType     = "Caja";
         g_activeTradeZoneLow  = g_rectPriceLow;
         g_activeTradeZoneHigh = g_rectPriceHigh;
      }
      else if(StringFind(currentComment, "Estructural") >= 0)
      {
         double tol = DistanceInPoints ? (H1StructuralTolerancePts * _Point) : H1StructuralTolerancePts;
         g_activeTradeType     = "Estructural";
         g_activeTradeZoneLow  = g_h1StructuralPrice - tol;
         g_activeTradeZoneHigh = g_h1StructuralPrice + tol;
      }
      else if(StringFind(currentComment, "Tendencia") >= 0)
      {
         g_activeTradeType     = "Tendencia";
         g_activeTradeZoneLow  = 0.0;
         g_activeTradeZoneHigh = 0.0;
      }
      else
      {
         // Deteccion heuristica segun precio de apertura
         if(g_rectActive && g_rectPriceLow > 0 && openPrice >= g_rectPriceLow && openPrice <= g_rectPriceHigh)
         {
            g_activeTradeType     = "Caja";
            g_activeTradeZoneLow  = g_rectPriceLow;
            g_activeTradeZoneHigh = g_rectPriceHigh;
         }
         else
         {
            g_activeTradeType     = "Desconocido";
            g_activeTradeZoneLow  = 0.0;
            g_activeTradeZoneHigh = 0.0;
         }
      }
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

   // Evaluar si el precio sigue dentro de la zona o del margen de proteccion SL (+1 vela M5)
   double zoneCeiling = 0.0;
   double zoneFloor   = 0.0;
   if(g_activeTradeType == "Caja")
   {
      zoneCeiling = (g_activeTradeZoneHigh > 0) ? g_activeTradeZoneHigh : g_rectPriceHigh;
      zoneFloor   = (g_activeTradeZoneLow > 0) ? g_activeTradeZoneLow : g_rectPriceLow;
   }
   else if(g_activeTradeType == "Estructural")
   {
      zoneCeiling = g_activeTradeZoneHigh;
      zoneFloor   = g_activeTradeZoneLow;
   }

   double m5Height = GetM5CandleHeight();
   double slMargin = (m5Height * ZoneSlCandlesM5) + (DistanceInPoints ? (ZoneExitBufferPts * _Point) : ZoneExitBufferPts);
   double slPrice  = (zoneCeiling > 0) ? (zoneCeiling + slMargin) : 0.0;

   // Se considera dentro de zona protegida mientras no supere el nivel de Stop Loss (+1 vela M5)
   bool inZone = false;
   if(zoneFloor > 0 && slPrice > 0)
      inZone = (currentBid >= zoneFloor && currentBid <= slPrice);

   // ====================================================================
   // REGLA CRITICA: STOP LOSS A 1 VELA DE 5 MINUTOS TRAS TERMINAR LA ZONA
   // ====================================================================
   // En operaciones SELL de Crash por zona (Caja o Estructural), el SL se ubica
   // exactamente a 1 vela M5 (ZoneSlCandlesM5) despues de terminar la zona.
   // Si el precio supera ese nivel, o permanece 5 min (1 vela M5) fuera de la
   // zona sin spike, se ejecuta el cierre inmediato por invalidacion.
   if(CloseOnZoneExit && (g_activeTradeType == "Caja" || g_activeTradeType == "Estructural") && zoneCeiling > 0)
   {
      // Monitoreo de tiempo transcurrido fuera del techo de la zona
      if(currentBid > zoneCeiling)
      {
         if(g_zoneExitTime == 0)
            g_zoneExitTime = TimeCurrent();
      }
      else
      {
         g_zoneExitTime = 0; // Regreso al interior de la zona
      }

      bool slTriggered = false;
      string slReason  = "";

      // Condicion 1: Precio supera 1 vela M5 por encima de la zona
      if(slPrice > 0 && currentBid > slPrice)
      {
         slTriggered = true;
         slReason = StringFormat("Precio %.*f supero techo %.*f + 1 vela M5 (%.*f pts, SL en %.*f)",
                                 _Digits, currentBid, _Digits, zoneCeiling, _Digits, slMargin, _Digits, slPrice);
      }
      // Condicion 2: El precio lleva 5 minutos (1 vela M5 = 300 seg) fuera de la zona sin reaccion de spike
      else if(CloseAfterM5TimeOutside && g_zoneExitTime > 0 && (TimeCurrent() - g_zoneExitTime) >= 300)
      {
         slTriggered = true;
         slReason = StringFormat("1 vela M5 (5 min) transcurridos fuera de la zona (techo %.*f) sin spike",
                                 _Digits, zoneCeiling);
      }

      if(slTriggered)
      {
         Print(StringFormat("STOP LOSS DE ZONA en %s: %s (tipo: %s). Cerrando operacion.",
                            _Symbol, slReason, g_activeTradeType));

         if(ClosePositionRobust(currentTicket))
         {
            g_lossHour            = iTime(_Symbol, PERIOD_H1, 0); // Bloquear reentradas en esta hora
            g_lastCloseTime       = TimeCurrent();
            g_activeTicket        = 0;
            g_spikeDetected       = false;
            g_lastSpikeTime       = 0;
            g_positionOpenTime    = 0;
            g_zoneExitTime        = 0;
            g_activeTradeType     = "";
            g_activeTradeZoneLow  = 0.0;
            g_activeTradeZoneHigh = 0.0;

            if(EnableTradeAlerts)
            {
               Alert(StringFormat("Stop Loss de Zona: Operacion en %s cerrada. %s.", _Symbol, slReason));
            }
            return;
         }
      }
   }

   // 0. CONTROL DE STOP LOSS EN USD: Si la perdida alcanza -3 USD (MaxLossUSD), cerrar inmediatamente
   // Regla: NO cerrar el trade mientras el precio este dentro de la zona demarcada
   if(MaxLossUSD > 0.0 && currentProfit <= -MaxLossUSD)
   {
      if(NoSlInZone && inZone)
      {
         // El precio sigue dentro de la zona demarcada: se protege la posicion y NO se cierra esperando el spike
      }
      else
      {
         Print(StringFormat("Stop Loss monetario alcanzado en %s: Profit %.2f USD (limite -%.2f USD%s). Cerrando operacion.",
                            _Symbol, currentProfit, MaxLossUSD,
                            (NoSlInZone ? ", fuera de zona demarcada" : "")));

         if(ClosePositionRobust(currentTicket))
         {
            g_lossHour            = iTime(_Symbol, PERIOD_H1, 0); // Bloquear reentradas en esta hora
            g_lastCloseTime       = TimeCurrent();
            g_activeTicket        = 0;
            g_spikeDetected       = false;
            g_lastSpikeTime       = 0;
            g_positionOpenTime    = 0;
            g_activeTradeType     = "";
            g_activeTradeZoneLow  = 0.0;
            g_activeTradeZoneHigh = 0.0;

            if(EnableTradeAlerts)
            {
               Alert(StringFormat("SL Monetario: Operacion en %s cerrada con perdida de %.2f USD (limite: -%.2f USD).",
                                  _Symbol, currentProfit, MaxLossUSD));
            }
            return;
         }
      }
   }

   // 1. Si NO ha habido ningun spike: evaluar tras 15 minutos (MaxMinutesWithoutSpike)
   if(!g_spikeDetected && MaxMinutesWithoutSpike > 0 && g_positionOpenTime > 0)
   {
      int elapsedNoSpike = (int)(TimeCurrent() - g_positionOpenTime);
      int maxSec = MaxMinutesWithoutSpike * 60;

      if(elapsedNoSpike >= maxSec)
      {
         // REGLA CRITICA: Si sigue dentro de la zona demarcada, NO cerrar el trade
         if(NoSlInZone && inZone)
         {
            // Sigue dentro de la zona: mantener abierto esperando reaccion
         }
         // Si esta en profit pero menor a 3 USD, NO cerrar, dejar correr
         else if(currentProfit >= 0.0 && currentProfit < MinProfitUSD)
         {
            // Dejar correr a la espera de spike
         }
         else if(currentProfit >= MinProfitUSD)
         {
            Print(StringFormat("15 min transcurridos en %s con profit de %.2f USD (>= %.2f USD). Cerrando en ganancia.",
                               _Symbol, currentProfit, MinProfitUSD));

            if(ClosePositionRobust(currentTicket))
            {
               g_lastCloseTime       = TimeCurrent();
               g_activeTicket        = 0;
               g_spikeDetected       = false;
               g_lastSpikeTime       = 0;
               g_positionOpenTime    = 0;
               g_activeTradeZoneLow  = 0.0;
               g_activeTradeZoneHigh = 0.0;
               g_activeTradeType     = "";

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
         // REGLA CRITICA: Si el precio sigue dentro de la zona demarcada, NO cerrar el trade
         // (evita cerrar en zona y reabrir de inmediato a peor precio)
         if(NoSlInZone && inZone)
         {
            // Sigue dentro de la zona: mantener trade abierto
         }
         // Si esta en profit pero menor a 3 USD, NO cerrar, dejar correr
         else if(currentProfit >= 0.0 && currentProfit < MinProfitUSD)
         {
            // Dejar correr esperando otro spike o mayor ganancia
         }
         else if(currentProfit >= MinProfitUSD)
         {
            Print(StringFormat("5 minutos tras spike cumplidos en %s con profit de %.2f USD (>= %.2f USD). Cerrando en ganancia fuera de zona.",
                               _Symbol, currentProfit, MinProfitUSD));

            if(ClosePositionRobust(currentTicket))
            {
               g_lastCloseTime       = TimeCurrent();
               g_activeTicket        = 0;
               g_spikeDetected       = false;
               g_lastSpikeTime       = 0;
               g_positionOpenTime    = 0;
               g_activeTradeZoneLow  = 0.0;
               g_activeTradeZoneHigh = 0.0;
               g_activeTradeType     = "";

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

   // Actualizar evaluacion de Filtro Vela Amiga H1
   if(UseVelaAmigaFilter)
      CheckVelaAmigaH1();
   else
      g_velaAmigaBlocked = false;

   // Actualizar evaluacion de Filtro Progresion Cuerpo de Vela H1 (Estrategia 1)
   if(UseCandleBodyProgFilter)
      CheckCandleProgressionH1();
   else
      g_candleProgressionBlocked = false;

   bool progBlocked = (UseCandleBodyProgFilter && g_candleProgressionBlocked);

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(bid <= 0)
      return;

   // REGLA CRITICA 1: NUNCA entrar al final de un spike en NINGUN modo
   if(IsRecentSpikeActive(bid))
      return;

   // REGLA CRITICA 2: La vela M1 actual (barra 0) DEBE ser verde o neutra (acumulacion alcista hacia arriba)
   // NUNCA entrar mientras la vela actual este cayendo (roja)
   double m1Open0 = iOpen(_Symbol, PERIOD_M1, 0);
   if(m1Open0 > 0 && bid < m1Open0)
      return;

   bool isBoxEntry        = false;
   bool isTrendEntry      = false;
   bool isStructuralEntry = false;
   string entryType       = "";

   // ==============================================================
   // MODO ESTRUCTURAL H1: ENTRADA POR LLEGADA AL NIVEL HORIZONTAL
   // ==============================================================
   if(UseH1StructuralLevel && g_h1StructuralActive && g_h1StructuralPrice > 0)
   {
      bool structuralBlocked = (ApplyVelaAmigaToStructural && UseVelaAmigaFilter && g_velaAmigaBlocked);
      if(ApplyProgressionToStructural && progBlocked)
         structuralBlocked = true;

      if(!structuralBlocked)
      {
         double tol = DistanceInPoints ? (H1StructuralTolerancePts * _Point) : H1StructuralTolerancePts;
         double structFloor = g_h1StructuralPrice - tol;
         if(OnlyUpperHalfOfZone && ZoneEntryRatio > 0.0)
            structFloor = (g_h1StructuralPrice - tol) + (2.0 * tol) * ZoneEntryRatio;

         // Si el precio actual alcanzo la mitad superior del nivel horizontal estructural
         if(bid >= structFloor && bid <= (g_h1StructuralPrice + tol))
         {
            int greenM1 = GetConsecutiveGreenM1();
            if(greenM1 >= MinGreenCandlesAfterSpike)
            {
               isStructuralEntry = true;
               entryType         = StringFormat("Nivel Estructural H1 (%.*f, %dv)", _Digits, g_h1StructuralPrice, greenM1);
            }
         }
      }
   }

   // Bloqueo de Vela Amiga y Progresion para entradas estandar de Caja y Tendencia
   bool standardBlocked = (UseVelaAmigaFilter && g_velaAmigaBlocked);
   bool boxProgBlocked  = (ApplyProgressionToBox && progBlocked);

   // ==============================================================
   // CASO A: SWITCH "SOLO ESTRATEGIA" ACTIVADO (g_onlyStrategy == true)
   // ==============================================================
   // Solo entra cuando el precio toca el rectangulo morado del patron V.
   // NO evalua EMA, NO evalua RSI, pero SI EXIGE acumulacion verde sin spikes
   if(g_onlyStrategy && !standardBlocked && !boxProgBlocked)
   {
      if(g_rectActive && g_rectPriceLow > 0 && g_rectPriceHigh > g_rectPriceLow)
      {
         double entryFloor = g_rectPriceLow;
         if(OnlyUpperHalfOfZone && ZoneEntryRatio > 0.0)
            entryFloor = g_rectPriceLow + (g_rectPriceHigh - g_rectPriceLow) * ZoneEntryRatio;

         if(bid >= entryFloor && bid < g_rectPriceHigh)
         {
            int greenM1 = GetConsecutiveGreenM1();
            if(greenM1 >= MinGreenCandlesAfterSpike)
            {
               isBoxEntry = true;
               entryType  = StringFormat("Solo Estrategia (Caja V 50%%+, %dv)", greenM1);
            }
         }
      }
   }
   // ==============================================================
   // CASO B: SWITCH EN OFF -> EVALUA TODO LO DEMAS
   // ==============================================================
   else if(!g_onlyStrategy && !standardBlocked)
   {
      // --- MODO 1: Entrada en el Rectangulo con filtros adicionales ---
      if(!boxProgBlocked && g_rectActive && g_rectPriceLow > 0 && g_rectPriceHigh > g_rectPriceLow)
      {
         double entryFloor = g_rectPriceLow;
         if(OnlyUpperHalfOfZone && ZoneEntryRatio > 0.0)
            entryFloor = g_rectPriceLow + (g_rectPriceHigh - g_rectPriceLow) * ZoneEntryRatio;

         if(bid >= entryFloor && bid < g_rectPriceHigh)
         {
            bool trendOk = IsTrendBearish();
            double currentRsi = 0.0;
            bool rsiOk   = IsRsiOverbought(currentRsi);
            int greenM1  = GetConsecutiveGreenM1();
            bool greenOk = (!UseConsecutiveM1Filter || greenM1 >= MinConsecutiveGreenM1);

            if(trendOk && rsiOk && greenOk)
            {
               isBoxEntry = true;
               entryType  = StringFormat("Zona Rectangulo 50%%+ (+Filtros, %dv)", greenM1);
            }
         }
      }

      // --- MODO 2: Continuacion de Tendencia Bajista (Opcion B fuera de caja) ---
      bool trendProgBlocked = (ApplyProgressionToTrend && progBlocked);
      if(!isBoxEntry && !isStructuralEntry && EnableTrendContinuation && !trendProgBlocked)
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

   // Si hay senal por alguno de los modos -> Ejecutar SELL
   if(isBoxEntry || isTrendEntry || isStructuralEntry)
   {
      double freshBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(freshBid <= 0)
         return;

      // Verificacion critica inmediata: Si cayo un spike justo antes de enviar la orden
      if(NeverEnterAfterSpike && (bid - freshBid) >= PreExecutionDropLimitPts)
      {
         PrintFormat("Alerta: SELL abortado por spike en ejecucion (bid cayo de %.*f a %.*f, caida %.*f >= limite %.*f pts).",
                     _Digits, bid, _Digits, freshBid, _Digits, bid - freshBid, _Digits, PreExecutionDropLimitPts);
         g_lastSpikeTimestamp = TimeCurrent();
         g_spikeBlocked = true;
         return;
      }

      double lot = GetLotSizeForSymbol();

      trade.SetDeviationInPoints(SlippagePoints);
      trade.SetTypeFillingBySymbol(_Symbol);

      double tpPrice = 0.0;
      if(TakeProfitPoints > 0)
      {
         tpPrice = freshBid - (TakeProfitPoints * _Point);
         tpPrice = NormalizeDouble(tpPrice, _Digits);
      }

      string commentTag = isStructuralEntry ? "Estructural H1" : (isBoxEntry ? "Caja" : "Tendencia");
      string comment = StringFormat("Crash-V [%s]", commentTag);

      // Se ejecuta SELL gestionando salida por USD y tiempo en el EA
      if(trade.Sell(lot, _Symbol, freshBid, 0.0, tpPrice, comment))
      {
         if(isTrendEntry)
            g_trendContTradesInHour++;

         if(isBoxEntry)
         {
            g_activeTradeType     = "Caja";
            g_activeTradeZoneLow  = g_rectPriceLow;
            g_activeTradeZoneHigh = g_rectPriceHigh;
         }
         else if(isStructuralEntry)
         {
            double tol = DistanceInPoints ? (H1StructuralTolerancePts * _Point) : H1StructuralTolerancePts;
            g_activeTradeType     = "Estructural";
            g_activeTradeZoneLow  = g_h1StructuralPrice - tol;
            g_activeTradeZoneHigh = g_h1StructuralPrice + tol;
         }
         else
         {
            g_activeTradeType     = "Tendencia";
            g_activeTradeZoneLow  = 0.0;
            g_activeTradeZoneHigh = 0.0;
         }

         g_lastTradeHour    = currentH1;
         g_lastTrackedBid   = freshBid;
         g_spikeDetected    = false;
         g_lastSpikeTime    = 0;
         g_positionOpenTime = TimeCurrent();
         g_activeTicket     = trade.ResultOrder();

         if(EnableTradeAlerts)
         {
            Alert(StringFormat("¡Entrada SELL por %s en %s!\nPrecio: %s\nLote: %s\nSL Monetario: -%.2f USD\nObjetivo: +%.2f USD",
                               entryType, _Symbol, DoubleToString(freshBid, _Digits),
                               DoubleToString(lot, 2), MaxLossUSD, MinProfitUSD));
         }
         Print(StringFormat("Orden SELL (%s) ejecutada. Ticket: %d, Lot: %s, Precio: %s, SL: -%.2f USD",
                            entryType, trade.ResultOrder(), DoubleToString(lot, 2),
                            DoubleToString(freshBid, _Digits), MaxLossUSD));
      }
      else
      {
         Print("Error al ejecutar Sell: ", trade.ResultRetcode(), " - ", trade.ResultRetcodeDescription());
      }
   }
}
//+------------------------------------------------------------------+