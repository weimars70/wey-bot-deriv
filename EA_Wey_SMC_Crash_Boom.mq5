//+------------------------------------------------------------------+
//|                                      EA_Wey_SMC_Crash_Boom.mq5   |
//|  Zonas de reaccion + CHoCH para indices Crash/Boom               |
//|                                                                   |
//|  1) Marca swings validos como zonas potenciales de retesteo.        |
//|  2) Boom busca soporte para spike alcista; Crash, resistencia       |
//|     para spike bajista.                                             |
//|  3) Opera rechazo de zona, retest o continuacion estructural.       |
//|  4) Boom: compras en soporte. Crash: ventas en resistencia.        |
//|                                                                   |
//|  Instalar en el grafico Crash/Boom elegido (p. ej. M5).           |
//+------------------------------------------------------------------+
#property copyright "Wey 2026"
#property version   "2.17"
#property description "Boom/Crash: continuacion N activa con riesgo ajustado por lote"

// Sin dependencias externas: no usa Trade.mqh, envia ordenes con OrderSend

//========================== INPUTS ================================//
input group "=== General ==="
input long             MagicNumber        = 880011;
input double           FixedLotSize       = 0.50;           // lote maximo por entrada; se reduce si supera el riesgo permitido
input bool             EnableAutoTrading  = true;           // habilita entradas automaticas de zona y continuacion
input ENUM_TIMEFRAMES  HTF_Bias           = PERIOD_H1;      // TF del sesgo
input int              BiasMode           = 1;              // 0=Off, 1=Estructura HTF con respaldo EMA, 2=EMA HTF
input int              HTFSwingStrength   = 2;              // fractal HTF (velas a cada lado)
input int              EMAPeriod          = 100;            // solo si BiasMode = EMA

input group "=== Reacciones y estructura (TF del grafico) ==="
input int              SwingStrength      = 2;              // fractal (velas a cada lado)
input int              ReactionLookbackBars = 300;          // barras historicas para buscar reacciones
input int              MinZoneReactions   = 3;              // minimo de swings distintos en la zona
input double           ZoneToleranceATR   = 0.25;           // tolerancia del nivel (x ATR)
input int              MinReactionSeparationBars = 8;       // separacion minima entre reacciones
input double           MinReactionBounceATR = 0.5;           // rebote minimo tras cada swing (x ATR)
input int              MinPullbackBars    = 12;             // duracion minima del retroceso hacia la zona
input double           PullbackMinDistanceATR = 1.5;         // distancia minima recorrida hacia la zona (x ATR)
input double           MinPullbackDirectionalPct = 60.0;     // % minimo de cierres en direccion del retroceso
input double           MaxEntryDistanceATR = 1.0;            // distancia maxima del CHoCH a la zona para no perseguir precio
input double           RetestToleranceATR  = 0.15;           // tolerancia para retestear el CHoCH (x ATR)
input bool             EnableSpikeImpulseEntries = true;      // v2.08: tras un spike a favor de la tendencia, entrar a MERCADO cuando el retroceso toque el % del spike
input double           SpikeEntryATR      = 2.0;             // tamano minimo del spike (x ATR previo al spike)
input double           SpikeRetracementPct = 50.0;           // nivel de entrada como % del recorrido origen-extremo del spike (50 = mitad)
input bool             EnableContinuationEntries = true;     // operar la N tras romper el swing intermedio
input bool             MarketContinuationEntries = true;      // entrar al mercado al confirmar la ruptura; false = esperar retesteo LIMIT
input bool             EnableAnticipatedLineEntries = true;     // entrar hasta 120 s antes de lineas activas; OB tambien al toque
input int              ContinuationMaxWaitBars = 6;          // antiguedad maxima del extremo de la N en velas
input int              TrendPullbackMaxBars  = 24;           // antiguedad maxima del swing para entrada en retroceso
input double           TrendPullbackMinATR   = 0.5;           // retroceso minimo para entrada en tendencia (x ATR)
input double           TrendPullbackMaxATR   = 2.5;           // retroceso maximo antes de descartar la tendencia (x ATR)
input int              ATRPeriod          = 14;
input int              ZoneMaxAgeBars     = 72;             // vida maxima de la zona (velas)

input group "=== v2: calidad de zona y tipo de entrada ==="
input double           MinRejectionWickPct = 35.0;           // mecha minima de rechazo en la vela de entrada (% del rango, 0 = off)
input bool             TrendPullbackMarketEntry = true;      // retroceso en tendencia: entrar a MERCADO al confirmar el rechazo (false = esperar nivel)
input bool             UseVirtualLimits = true;              // true: no usa BUY/SELL LIMIT del broker; vigila el nivel y entra a mercado al tocarlo
input double           VirtualTouchATR  = 0.10;              // tolerancia para dar por tocado el nivel (x ATR) y no quedarse a 1 tick

input group "=== v2.02: no entrar contra una zona de rebote ==="
input bool             BlockEntriesIntoOpposingZone = true;  // Boom: no comprar pegado a un techo donde el precio ya rebotó a la baja (Crash: espejo)
input int              OpposingLookbackBars = 300;           // velas hacia atras para buscar zonas de rebote en contra
input int              OpposingReactionBars = 15;            // velas tras el swing en las que se mide el rebote
input double           MinOpposingBounceATR = 1.5;           // rebote minimo para considerar el nivel una zona valida (x ATR)
input double           OpposingZoneATR    = 1.0;             // banda previa al nivel donde se bloquea la entrada (x ATR)
input double           OpposingToleranceATR = 0.25;          // tolerancia sobre el nivel; si cierra mas alla, el nivel se da por roto

input group "=== v2.03: rigor (menos entradas, mas calidad) ==="
input bool             EnableTrendPullbackEntries = true;    // retroceso a favor de tendencia confirmada
input bool             EnableNPatternEntries = true;         // patron N: entra tras pullback y ruptura del swing intermedio
input bool             RequireBiasNotAgainst = true;         // no operar contra el sesgo del TF superior (neutral permite)
input bool             RequireDiscountPremium = true;        // Boom: comprar solo en la parte baja del rango; Crash: vender en la alta
input int              RangePositionLookback = 90;           // velas para medir el rango
input double           MaxRangePositionPct = 60.0;           // posicion maxima dentro del rango para entrar (0-100)
input int              PostSpikeWaitBars = 8;                // velas de espera tras un spike a favor (no perseguir el techo), 0 = off
input double           PostSpikeATR       = 2.0;             // tamano de vela que cuenta como spike (x ATR)
input int              CooldownBarsAfterLoss = 8;            // velas de pausa tras una operacion perdedora, 0 = off
input int              MaxConsecutiveLossesDay = 2;          // perdidas seguidas que detienen el dia, 0 = off

input group "=== v2.07: guardas de riesgo ==="
input bool             GlobalRiskGuard    = true;               // las perdidas seguidas y el limite diario cuentan TODOS los simbolos con este Magic
input double           MaxLossPerTradeUSD = 8.0;                // no abrir si la perdida al SL supera X (moneda de cuenta); 0 = off

input group "=== v2.08: retroceso post-spike a favor de la tendencia (todos los indices Boom/Crash) ==="
input int              SpikeMaxWaitBars   = 60;              // velas maximas esperando el retroceso (se escala por indice: 500 -> x1.67, 1000 -> x3.33)
input bool             SpikeScaleWaitByIndex = true;         // escalar la espera segun el numero del indice (300/500/1000)
input double           SpikeMaxEntryRetracePct = 85.0;       // si el retroceso ya paso este % del spike, no se persigue (SL quedaria pegado al origen)
input double           SpikeSLBufferATR   = 0.5;             // colchon del SL mas alla del origen del spike (x ATR)
input double           SpikeMaxSL_ATR     = 6.0;             // SL maximo permitido desde la entrada (x ATR)
input bool             SpikeRequireTrend  = true;            // exige tendencia del TF del grafico a favor (Crash: LH + LL / Boom: HL + HH)
input int              SpikeTrendLookback = 150;             // velas para medir la tendencia
input bool             SpikeIgnoreHTFBias = true;            // la tendencia del grafico manda: no bloquear por el sesgo H1/EMA (que va retrasado)
input bool             SpikeIgnoreRangeAndPostSpike = true;  // no aplicar "espera post-spike" ni "zona barata/cara" a esta entrada (son el opuesto de lo buscado)

input group "=== v2.09: compresion previa a ruptura en Crash ==="
input bool             EnableCrashCompressionEntries = true; // Crash: vender solo tras cierre bajo el soporte de una compresion
input int              CrashCompressionLookbackBars = 60;    // velas maximas para encontrar la compresion
input int              CrashCompressionMinLowerHighs = 3;    // maximos descendentes consecutivos requeridos (3 = cuatro techos)
input double           CrashCompressionMinLowerHighATR = 0.10; // descenso minimo entre maximos (x ATR)
input double           CrashCompressionMinBounceATR = 0.50;   // rebote minimo entre maximo y minimo intermedio (x ATR)
input double           CrashCompressionMinShrinkPct = 15.0;   // cada rebote sucesivo al menos este % menor que el previo
input double           CrashCompressionSupportToleranceATR = 0.50; // diferencia maxima entre los soportes (x ATR)
input double           CrashCompressionBreakBufferATR = 0.30; // cierre debe romper el soporte por este margen (x ATR)
input double           CrashCompressionMaxBreakATR = 1.00;    // no vender si el precio ya se alejo mas que esto del soporte

input group "=== v2.05: tendencia mayor (entradas a largo plazo) ==="
input bool             EnableLongTermEntries = true;         // detecta tendencia escalonada y entra en el retroceso a un FVG/OB
input int              LT_EntryTrigger    = 1;               // 0 = al tocar la zona (tick), 1 = al cerrar vela de rechazo
input int              LT_LookbackBars    = 300;             // velas para evaluar la tendencia
input int              LT_MaxZoneAgeBars  = 200;             // antiguedad maxima de la zona
input int              LT_SwingStrength   = 3;               // fractal para medir la tendencia mayor
input double           LT_DisplacementATR = 1.0;             // vela impulsiva minima que deja el FVG (x ATR)
input double           LT_MinGapATR       = 0.3;             // tamano minimo del FVG (x ATR)
input bool             LT_FirstTouchOnly  = false;           // true = solo el primer retorno a la zona (mas estricto)
input double           LT_MinWickPct      = 0.0;             // mecha minima de rechazo en modo 1 (0 = no exigir)
input double           LT_SLBufferATR     = 0.3;             // colchon del SL (x ATR)
input int              LT_SLMode          = 1;               // 0 = SL tras el borde lejano de la zona (amplio), 1 = tras el extremo reciente (ajustado)
input int              LT_SLSwingBars     = 6;               // modo 1: velas recientes cuyo extremo protege la entrada
input double           LT_NearToleranceATR = 0.5;            // se acepta la entrada a X ATR antes de llegar al borde de la zona
input double           LT_MaxPenetrationPct = 70.0;          // no entrar si el precio ya recorrio mas de este % de la zona
input double           LT_MaxSL_ATR       = 8.0;             // SL maximo permitido (x ATR)
input double           LT_BreakEvenATR    = 3.0;             // breakeven al avanzar X ATR
input double           LT_BreakEvenLockATR = 0.3;            // ganancia asegurada en el breakeven
input double           LT_TrailStartATR   = 4.0;             // empieza el trailing estructural al avanzar X ATR
input double           LT_TrailSwingBufferATR = 0.3;         // colchon tras el swing usado de trailing
input double           LT_TrailMaxDistanceATR = 10.0;        // el SL nunca queda mas lejos que esto del precio
input double           LT_LockStartATR    = 8.0;             // desde este avance se asegura una fraccion de la ganancia (0 = off)
input double           LT_LockFraction    = 0.5;             // fraccion de la ganancia flotante que se asegura (0-0.9)

input group "=== Referencias historicas del grafico ==="
input bool             ShowOB             = true;           // dibujar OB; los OB validos tocados pueden generar entradas
input bool             ShowBrokenOB       = false;
input bool             ShowFVG            = true;           // FVG historicos; no generan entradas
input double           FVGMinATR          = 0.15;
input bool             ShowPD             = true;
input int              PDLookback         = 90;
input double           DisplacementATR    = 0.7;            // filtros solo para dibujar OB historicos
input double           MinLegATR          = 1.0;
input int              OBZone             = 0;              // 0=rango completo, 1=solo cuerpo
input double           ZoneOpacity        = 0.28;           // opacidad de rellenos FVG historicos

input group "=== Riesgo ==="
input double           SLBufferATR        = 0.15;           // colchon del SL tras la zona (x ATR)
input double           MinSL_ATR          = 1.5;            // SL minimo (x ATR)
input double           MaxSL_ATR          = 3.0;            // SL maximo (x ATR)
input bool             AllowAdditionalOBTouchPositions = false; // permitir entradas por OB tocado aunque haya otra posicion
input int              LimitOrderExpiryBars = 5;            // expiracion de orden limite en velas del grafico
input double           TrailStartATR      = 1.0;            // iniciar trailing al avanzar X ATR desde la entrada
input double           TrailDistanceATR   = 2.0;            // distancia del SL al precio favorable (x ATR)
input double           TrailStepATR       = 0.1;            // mejora minima del SL para modificarlo (x ATR)
input double           BreakEvenATR       = 1.2;            // mover SL a breakeven al avanzar X ATR (0 = off)
input double           BreakEvenLockATR   = 0.1;            // ganancia asegurada al pasar a breakeven (x ATR)
input int              TrailMode          = 2;              // 0=ATR, 1=estructura (swing), 2=hibrido (swing con tope ATR)
input double           TrailSwingBufferATR = 0.2;           // colchon bajo/sobre el swing usado como trailing (x ATR)
input double           TrailMaxDistanceATR = 3.0;           // modo hibrido: el SL nunca queda mas lejos que esto (x ATR)
input double           SpikeTightenATR    = 4.0;            // si el avance supera X ATR (spike) se aprieta el trailing (0 = off)
input double           SpikeTrailDistanceATR = 0.6;         // distancia del trailing tras spike (x ATR)
input int              MaxOpenPositions   = 2;
input int              MaxPositionsPerIndex = 2;            // tope duro de posiciones por indice, valga la ruta de entrada que sea
input double           SecondEntryMinProfitUSD = 10.0;      // la 2da entrada solo si la 1ra esta en ganancia >= X (moneda de cuenta)
input double           DailyLossLimitUSD  = 0.0;            // detener al perder X en moneda de cuenta (0 = sin limite)
input double           DailyProfitTargetUSD = 0.0;          // detener al ganar X en moneda de cuenta (0 = sin limite)

input group "=== Filtros (horas = hora del SERVIDOR del broker) ==="
input bool             UseSession         = false;
input int              SessionStartHour   = 9;              // hora inicial del servidor
input int              SessionEndHour     = 19;             // hora final del servidor
input double           MaxSpreadPctSL     = 30.0;           // spread maximo como % del SL
input int              DeviationPoints    = 30;             // desviacion maxima en puntos del simbolo

input group "=== Visual / Debug ==="
input bool             DrawObjects        = true;           // zona de reaccion + flechas de entrada
input bool             ShowStructure      = true;           // BOS / CHoCH
input bool             ShowSwings         = true;           // HH / HL / LH / LL / EQH / EQL
input bool             ShowPanel          = true;           // panel de estado en la esquina
input int              VisBars            = 400;            // velas hacia atras a analizar
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
   datetime t;         // hora de la primera visita actual a la zona
   datetime startTime; // hora de la reaccion historica mas antigua del grupo
   int      age;       // velas transcurridas desde la visita
   int      reactions; // numero de reacciones historicas agrupadas
   bool     trendSetup;
   double   breakLevel;
   bool     rejectionConfirmed;
   bool     chochConfirmed;
   bool     retestConfirmed;
};

struct SMCTradeZone
{
   int      dir;
   double   top;
   double   bottom;
   string   key;
};

SMCZone  zones[];
SMCTradeZone touchedOBZones[];
int      atrHandle   = INVALID_HANDLE;
int      emaHandle   = INVALID_HANDLE;
datetime lastBarTime = 0;
datetime biasBarTime = 0;
int      biasDir     = 0;     // +1 alcista, -1 bajista, 0 neutral
string   biasSource  = "estructura HTF";
int      allowedDir  = 0;     // Boom = +1 (solo compras), Crash = -1 (solo ventas)
string   indexType   = "";
datetime dailyLimitDay = 0;
bool     dailyLimitReached = false;
string   dailyLimitReason = "";
datetime lastSpikeDetectedBar = 0;
datetime pendingSpikeBar = 0;
double   pendingSpikeEntry = 0;
double   pendingSpikeExtreme = 0;
double   pendingSpikeATR = 0;
bool     spikeRetracementPending = false;
datetime spikeKey = 0;               // v2.08: barra de origen del spike vigente
datetime spikeDoneKey = 0;           // v2.08: ultimo spike ya operado/descartado
double   pendingSpikeOrigin = 0;     // v2.08: apertura de la primera vela del spike
double   pendingSpikeSLRef = 0;      // v2.08: maximo (Crash) / minimo (Boom) del spike, referencia del SL
bool     gSpikeEntry = false;        // v2.08: la entrada en curso es de retroceso post-spike
ulong    spikeLastTryMs = 0;
string   crashCompressionStatus = "buscando estructura";
string   continuationStatus = "esperando evaluacion";
double   anticipatedWatchLevel = 0;
bool     hasAnticipatedWatchLevel = false;
double   approachPrices[16];
long     approachTimes[16];
int      approachSampleCount = 0;
int      approachNextSample = 0;
long     approachLastSampleSecond = -1;
struct VirtualOrder
{
   bool     active;
   int      dir;
   double   level;
   double   sl;
   double   lots;
   string   cm;
   datetime expires;
};
VirtualOrder gVirt;
string   triggeredLineKeys[];
string   wideStopWarningKeys[];

//=========================== UTILS ================================//
// Ultimo motivo de descarte por direccion (0 = compra, 1 = venta).
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

bool ApplyTenMinuteStop(const int dir, const double entry,
                        const double minimumDistance, double &sl)
{
   const int lookbackMinutes = 10;
   MqlRates m1[];
   ArraySetAsSeries(m1, true);
   if(CopyRates(_Symbol, PERIOD_M1, 1, lookbackMinutes + ATRPeriod + 1, m1) !=
      lookbackMinutes + ATRPeriod + 1)
   {
      Log("no hay suficientes velas M1 cerradas para calcular el SL de 10 minutos");
      return false;
   }

   double highest = -DBL_MAX;
   double lowest = DBL_MAX;
   for(int i = 0; i < lookbackMinutes; i++)
   {
      highest = MathMax(highest, m1[i].high);
      lowest = MathMin(lowest, m1[i].low);
   }

   double atrM1 = 0;
   for(int i = 0; i < ATRPeriod; i++)
      atrM1 += MathMax(m1[i].high, m1[i+1].close) -
               MathMin(m1[i].low, m1[i+1].close);
   atrM1 /= ATRPeriod;
   if(atrM1 <= 0)
   {
      Log("ATR M1 invalido para calcular el margen del SL de 10 minutos");
      return false;
   }

   double buffer = SLBufferATR * atrM1;
   double minimum = MathMax(minimumDistance, MinSL_ATR * atrM1);
   if(dir > 0)
      sl = MathMin(sl, MathMin(lowest - buffer, entry - minimum));
   else
      sl = MathMax(sl, MathMax(highest + buffer, entry + minimum));
   return true;
}

string ZoneName(const SMCZone &z)
{
   return "SMC_" + (z.dir > 0 ? "B_" : "S_") + IntegerToString((long)z.t);
}

//======================== INIT / DEINIT ===========================//
int OnInit()
{
   string upperSymbol = _Symbol;
   StringToUpper(upperSymbol);
   bool isBoom = (StringFind(upperSymbol, "BOOM") >= 0);
   bool isCrash = (StringFind(upperSymbol, "CRASH") >= 0);
   if(isBoom == isCrash)
   {
      Print("[SMC CB] Simbolo no reconocido como Crash o Boom: ", _Symbol);
      return INIT_FAILED;
   }
   allowedDir = isBoom ? 1 : -1;
   indexType = isBoom ? "BOOM" : "CRASH";

   double volumeMin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double volumeMax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double volumeStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(SwingStrength < 1 || HTFSwingStrength < 1 || ReactionLookbackBars < 30 ||
      ReactionLookbackBars > 5000 || MinZoneReactions < 2 ||
      ZoneToleranceATR <= 0 || MinReactionSeparationBars < 1 ||
      MinReactionBounceATR < 0 || MinPullbackBars < 2 ||
      PullbackMinDistanceATR <= 0 ||
      MinPullbackDirectionalPct < 50 || MinPullbackDirectionalPct > 100 ||
      MaxEntryDistanceATR <= 0 || RetestToleranceATR <= 0 ||
      SpikeEntryATR <= 0 || SpikeRetracementPct <= 0 || SpikeRetracementPct >= 100 ||
      ContinuationMaxWaitBars < 1 || TrendPullbackMaxBars < SwingStrength + 2 ||
      TrendPullbackMinATR <= 0 || TrendPullbackMaxATR < TrendPullbackMinATR ||
      ATRPeriod < 1 || ZoneMaxAgeBars < 1 ||
      BiasMode < 0 || BiasMode > 2 || EMAPeriod < 1 ||
      TrailStartATR <= 0 || TrailDistanceATR <= 0 || TrailStepATR <= 0 ||
      FixedLotSize <= 0 || volumeStep <= 0 ||
      FixedLotSize < volumeMin || FixedLotSize > volumeMax ||
      MathAbs(FixedLotSize / volumeStep - MathRound(FixedLotSize / volumeStep)) > 1e-8 ||
      MaxOpenPositions < 1 || LimitOrderExpiryBars < 1 ||
      DailyLossLimitUSD < 0 || DailyProfitTargetUSD < 0 ||
      TrailMode < 0 || TrailMode > 2 || TrailMaxDistanceATR <= 0 ||
      MinRejectionWickPct < 0 || MinRejectionWickPct > 90 || VirtualTouchATR < 0 ||
      MaxPositionsPerIndex < 1 || SecondEntryMinProfitUSD < 0 ||
      RangePositionLookback < 10 || MaxRangePositionPct <= 0 || MaxRangePositionPct > 100 ||
      PostSpikeWaitBars < 0 || PostSpikeATR <= 0 || CooldownBarsAfterLoss < 0 || MaxConsecutiveLossesDay < 0 ||
      OpposingLookbackBars < 30 || OpposingReactionBars < 2 || MinOpposingBounceATR < 0 ||
      OpposingZoneATR < 0 || OpposingToleranceATR < 0 ||
      LT_EntryTrigger < 0 || LT_EntryTrigger > 1 || LT_LookbackBars < 60 || LT_MaxZoneAgeBars < 10 ||
      LT_MaxZoneAgeBars >= LT_LookbackBars || LT_SwingStrength < 1 || LT_MaxSL_ATR <= 0 ||
      LT_LockFraction < 0 || LT_LockFraction > 0.9 || LT_TrailMaxDistanceATR <= 0 ||
      LT_SLMode < 0 || LT_SLMode > 1 || LT_SLSwingBars < 1 || LT_NearToleranceATR < 0 ||
      LT_MaxPenetrationPct <= 0 || LT_MaxPenetrationPct > 100 ||
      SpikeMaxWaitBars < 1 || SpikeMaxEntryRetracePct <= SpikeRetracementPct || SpikeMaxEntryRetracePct > 100 ||
      SpikeSLBufferATR < 0 || SpikeMaxSL_ATR <= 0 || SpikeTrendLookback < 40 ||
      CrashCompressionLookbackBars < 10 || CrashCompressionMinLowerHighs < 2 ||
      CrashCompressionMinLowerHighs > 6 || CrashCompressionMinLowerHighATR <= 0 ||
      CrashCompressionMinBounceATR <= 0 || CrashCompressionMinShrinkPct <= 0 ||
      CrashCompressionMinShrinkPct >= 100 || CrashCompressionSupportToleranceATR <= 0 ||
      CrashCompressionBreakBufferATR < 0 ||
      CrashCompressionMaxBreakATR <= CrashCompressionBreakBufferATR)
   {
      Print("[SMC CB] Parametros invalidos o lote fijo incompatible con el simbolo. Lote=", FixedLotSize,
            " minimo=", volumeMin, " maximo=", volumeMax, " paso=", volumeStep);
      return INIT_PARAMETERS_INCORRECT;
   }
   Print("[SMC CB] Simbolo=", _Symbol, " tipo=", indexType, " direccion permitida=",
         allowedDir > 0 ? "solo compras" : "solo ventas", " lote=", DoubleToString(FixedLotSize, 3));

   atrHandle = iATR(_Symbol, _Period, ATRPeriod);
   if(atrHandle == INVALID_HANDLE) { Print("No se pudo crear ATR"); return INIT_FAILED; }

   if(BiasMode == 1 || BiasMode == 2)
   {
      emaHandle = iMA(_Symbol, HTF_Bias, EMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(emaHandle == INVALID_HANDLE) { Print("No se pudo crear EMA"); return INIT_FAILED; }
   }

   if(PeriodSeconds(HTF_Bias) <= PeriodSeconds(_Period))
      Print("AVISO: el TF del sesgo deberia ser mayor que el TF del grafico");

   gVirt.active = false;
   ArrayResize(zones, 0);
   ArrayResize(touchedOBZones, 0);
   approachSampleCount = 0;
   approachNextSample = 0;
   approachLastSampleSecond = -1;
   ArrayResize(triggeredLineKeys, 0);
   ArrayResize(wideStopWarningKeys, 0);
   lastSpikeDetectedBar = iTime(_Symbol, _Period, 0);
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

int CountOurPendingOrders()
{
   int c = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong tk = OrderGetTicket(i);
      if(tk == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if((long)OrderGetInteger(ORDER_MAGIC) != MagicNumber) continue;
      c++;
   }
   if(gVirt.active) c++;
   return c;
}

double OurFloating()
{
   double p = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!GlobalRiskGuard && PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
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
      if(!GlobalRiskGuard && HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long type = HistoryDealGetInteger(tk, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;

      closedPnL += HistoryDealGetDouble(tk, DEAL_PROFIT)
                 + HistoryDealGetDouble(tk, DEAL_SWAP)
                 + HistoryDealGetDouble(tk, DEAL_COMMISSION)
                 + HistoryDealGetDouble(tk, DEAL_FEE);
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN &&
         HistoryDealGetString(tk, DEAL_SYMBOL) == _Symbol) entries++;   // el limite de operaciones es por indice
   }
}

// Control unico de posiciones: maximo MaxPositionsPerIndex; para abrir otra,
// todas las abiertas deben sumar ganancia flotante >= SecondEntryMinProfitUSD.
bool PositionCapAllows(string &why)
{
   int cnt = 0;
   double floating = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      cnt++;
      floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   if(cnt == 0) return true;
   if(cnt >= MaxPositionsPerIndex)
   {
      why = StringFormat("maximo de %d posiciones por indice alcanzado", MaxPositionsPerIndex);
      return false;
   }
   if(floating < SecondEntryMinProfitUSD)
   {
      why = StringFormat("2da entrada bloqueada: la 1ra lleva %.2f, se exige >= %.2f %s",
                         floating, SecondEntryMinProfitUSD, AccountInfoString(ACCOUNT_CURRENCY));
      return false;
   }
   return true;
}

bool SendReq(MqlTradeRequest &req);
bool CancelOurPendingOrders();
double CalcLots(const int dir, const double entry, const double sl);

bool CanTradeNow(const bool ignorePendingOrders = false,
                 const bool allowAdditionalPositions = false)
{
   if(!InSession())                              { Log("fuera de sesion");        return false; }

   MqlDateTime today;
   TimeToStruct(TimeCurrent(), today);
   today.hour = 0;
   today.min = 0;
   today.sec = 0;
   datetime dayStart = StructToTime(today);
   if(dayStart != dailyLimitDay)
   {
      dailyLimitDay = dayStart;
      dailyLimitReached = false;
      dailyLimitReason = "";
   }
   if(dailyLimitReached)
   {
      Log(dailyLimitReason + "; entradas bloqueadas hasta el proximo dia del servidor");
      CancelOurPendingOrders();
      return false;
   }

   double closed; int entries;
   DayStats(closed, entries);
   double dailyPnL = closed + OurFloating();
   if(DailyLossLimitUSD > 0 && dailyPnL <= -DailyLossLimitUSD)
   {
      dailyLimitReached = true;
      dailyLimitReason = "limite de perdida diaria alcanzado";
      Log(StringFormat("limite de perdida diaria alcanzado: PnL %.2f %s, limite -%.2f %s",
                       dailyPnL, AccountInfoString(ACCOUNT_CURRENCY),
                       DailyLossLimitUSD, AccountInfoString(ACCOUNT_CURRENCY)));
      CancelOurPendingOrders();
      return false;
   }
   if(DailyProfitTargetUSD > 0 && dailyPnL >= DailyProfitTargetUSD)
   {
      dailyLimitReached = true;
      dailyLimitReason = "objetivo de ganancia diaria alcanzado";
      Log(StringFormat("objetivo de ganancia diaria alcanzado: PnL %.2f %s, objetivo %.2f %s",
                       dailyPnL, AccountInfoString(ACCOUNT_CURRENCY),
                       DailyProfitTargetUSD, AccountInfoString(ACCOUNT_CURRENCY)));
      CancelOurPendingOrders();
      return false;
   }
   int positions = CountOurPositions();
   int pendingOrders = CountOurPendingOrders();
   if(!allowAdditionalPositions &&
      (positions >= MaxOpenPositions ||
       (!ignorePendingOrders && positions + pendingOrders >= MaxOpenPositions)))
                                                  { Log("posicion u orden pendiente abierta"); return false; }
   string capWhy;
   if(!PositionCapAllows(capWhy))                 { Log(capWhy);                   return false; }
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

//========================= DIBUJO / ZONAS =========================//
string WatchLineName()
{
   return "SMC_WATCH_" + (allowedDir > 0 ? "B" : "S");
}

void DrawWatchLevel(const SMCZone &z, const string status)
{
   anticipatedWatchLevel = (z.top + z.bottom) / 2.0;
   hasAnticipatedWatchLevel = true;
   if(!DrawObjects) return;

   string name = WatchLineName();
   double level = anticipatedWatchLevel;
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, level);

   ObjectSetDouble(0, name, OBJPROP_PRICE, level);
   ObjectSetInteger(0, name, OBJPROP_COLOR, Dim(z.dir > 0 ? clrAqua : clrTomato));
   ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASH);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, true);
   ObjectSetString(0, name, OBJPROP_TEXT,
                   StringFormat("%s: %s", z.dir > 0 ? "BOOM" : "CRASH", status));
   ObjectSetString(0, name, OBJPROP_TOOLTIP,
                   StringFormat("%s potencial %.5f | %s; referencia manual, no es una orden",
                                z.dir > 0 ? "Soporte" : "Resistencia", level, status));
}

void RemoveWatchLevel()
{
   hasAnticipatedWatchLevel = false;
   ObjectDelete(0, WatchLineName());
}

void DrawZone(const SMCZone &z)
{
   if(!DrawObjects) return;
   string nm = ZoneName(z);
   datetime t2 = TimeCurrent() + (datetime)(PeriodSeconds(_Period) * ZoneMaxAgeBars);
   datetime t1 = z.startTime;
   if(ObjectFind(0, nm) < 0)
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, z.top, t2, z.bottom);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, Dim(z.dir > 0 ? clrAqua : clrTomato));
   ObjectSetInteger(0, nm, OBJPROP_FILL, false);
   ObjectSetInteger(0, nm, OBJPROP_BACK, true);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
   string zoneStatus = (!z.trendSetup && z.reactions >= MinZoneReactions)
                       ? StringFormat("%d reacciones; entrada al primer toque", z.reactions)
                       : (z.rejectionConfirmed ? "rechazo confirmado" :
                          (!z.chochConfirmed ? "esperando CHoCH" :
                           (z.retestConfirmed ? "retest validado" : "esperando retest")));
   ObjectSetString(0, nm, OBJPROP_TOOLTIP,
                   StringFormat("%s: %s; %s",
                                z.dir > 0 ? "SOPORTE" : "RESISTENCIA",
                                z.trendSetup ? "retroceso en tendencia local" :
                                               StringFormat("%d reacciones", z.reactions),
                                zoneStatus));

   double lvl = (z.top + z.bottom) / 2.0;
   string ne  = nm + "_E";
   if(ObjectFind(0, ne) < 0)
      ObjectCreate(0, ne, OBJ_TREND, 0, t1, lvl, t2, lvl);
   ObjectSetInteger(0, ne, OBJPROP_COLOR, Dim(clrAqua));
   ObjectSetInteger(0, ne, OBJPROP_STYLE, STYLE_SOLID);
   ObjectSetInteger(0, ne, OBJPROP_RAY_RIGHT, false);

   if(z.chochConfirmed || z.rejectionConfirmed)
   {
      string nr = nm + "_R";
      if(ObjectFind(0, nr) < 0)
         ObjectCreate(0, nr, OBJ_HLINE, 0, 0, z.breakLevel);
      ObjectSetDouble(0, nr, OBJPROP_PRICE, z.breakLevel);
      bool confirmed = z.rejectionConfirmed || z.retestConfirmed;
      ObjectSetInteger(0, nr, OBJPROP_COLOR, confirmed ? clrAqua : clrOrange);
      ObjectSetInteger(0, nr, OBJPROP_STYLE, confirmed ? STYLE_SOLID : STYLE_DASH);
      ObjectSetInteger(0, nr, OBJPROP_WIDTH, confirmed ? 2 : 1);
      ObjectSetInteger(0, nr, OBJPROP_SELECTABLE, true);
      ObjectSetString(0, nr, OBJPROP_TEXT,
                      z.rejectionConfirmed ? "RECHAZO DE ZONA CONFIRMADO" :
                      (z.retestConfirmed ? "RETEST CONFIRMADO" : "CHoCH - esperando retest"));
      ObjectSetString(0, nr, OBJPROP_TOOLTIP,
                      StringFormat("%s %.5f | %s",
                                   z.dir > 0 ? "Compra Boom" : "Venta Crash",
                                   z.breakLevel,
                                   z.rejectionConfirmed ? "Rechazo de zona confirmado" :
                                   (z.retestConfirmed ? "Retest y rechazo confirmados" :
                                                        "Esperando retest")));
   }
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
      ObjectDelete(0, nm + "_R");
   }
   for(int k = idx; k < sz - 1; k++) zones[k] = zones[k+1];
   ArrayResize(zones, sz - 1);
}

bool IsZoneRejection(const MqlRates &bar, const SMCZone &z)
{
   double center = (z.top + z.bottom) / 2.0;
   double range = bar.high - bar.low;
   if(range <= 0) return false;
   double wick = (z.dir > 0) ? MathMin(bar.open, bar.close) - bar.low
                             : bar.high - MathMax(bar.open, bar.close);
   if(MinRejectionWickPct > 0 && wick / range * 100.0 < MinRejectionWickPct) return false;
   if(z.dir > 0)
      return bar.low <= z.top && bar.close >= z.bottom &&
             bar.close > center && bar.close > bar.open;

   return bar.high >= z.bottom && bar.close <= z.top &&
          bar.close < center && bar.close < bar.open;
}

bool IsConfirmedReaction(const MqlRates &r[], const int shift, const int n, const double atr)
{
   int last = MathMax(1, shift - MinReactionSeparationBars);
   double extreme = (allowedDir > 0) ? -DBL_MAX : DBL_MAX;
   for(int s = last; s < shift; s++)
   {
      if(allowedDir > 0) extreme = MathMax(extreme, r[s].high);
      else               extreme = MathMin(extreme, r[s].low);
   }
   if(extreme == -DBL_MAX || extreme == DBL_MAX) return false;
   double bounce = (allowedDir > 0) ? extreme - r[shift].low : r[shift].high - extreme;
   return (bounce >= MinReactionBounceATR * atr);
}

void SetWickZoneBounds(const double wickPrice, const double tolerance,
                       double &top, double &bottom)
{
   if(allowedDir > 0)
   {
      top = wickPrice;
      bottom = wickPrice - tolerance;
   }
   else
   {
      top = wickPrice + tolerance;
      bottom = wickPrice;
   }
}

bool FindReactionZone(const MqlRates &r[], const int n, const double atr, SMCZone &z)
{
   double H[], L[];
   ArrayResize(H, n);
   ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, n, hi, lo);
   int pivots[];
   if(allowedDir > 0) ArrayCopy(pivots, lo);
   else               ArrayCopy(pivots, hi);
   int minShift = MinPullbackBars + SwingStrength + 2;
   int maxShift = MathMin(ReactionLookbackBars, n - SwingStrength - 1);
   double tolerance = ZoneToleranceATR * atr;
   int bestCount = 0;
   double bestCenter = 0;
   int bestOldestShift = -1;
   bool hasBestCandidate = false;
   double bestDistance = DBL_MAX;
   double currentClose = r[1].close;

   for(int a = 0; a < ArraySize(pivots); a++)
   {
      int anchorShift = pivots[a];
      if(anchorShift < minShift || anchorShift > maxShift ||
         !IsConfirmedReaction(r, anchorShift, n, atr))
         continue;

      int count = 0, oldestShift = anchorShift;
      int lastAcceptedShift = -1;
      double sum = 0;
      for(int k = 0; k < ArraySize(pivots); k++)
      {
         int shift = pivots[k];
         if(shift < minShift || shift > maxShift ||
            MathAbs((allowedDir > 0 ? L[shift] : H[shift]) -
                    (allowedDir > 0 ? L[anchorShift] : H[anchorShift])) > tolerance ||
            !IsConfirmedReaction(r, shift, n, atr))
            continue;
         if(lastAcceptedShift >= 0 && shift - lastAcceptedShift < MinReactionSeparationBars)
            continue;
         double price = (allowedDir > 0) ? L[shift] : H[shift];
         sum += price;
         count++;
         oldestShift = MathMax(oldestShift, shift);
         lastAcceptedShift = shift;
      }

      if(count < MinZoneReactions) continue;
      double candidateCenter = sum / count;
      double candidateTop, candidateBottom;
      SetWickZoneBounds(candidateCenter, tolerance, candidateTop, candidateBottom);
      if((allowedDir > 0 && currentClose < candidateBottom) ||
         (allowedDir < 0 && currentClose > candidateTop))
         continue;

      double distance = (allowedDir > 0)
                        ? MathMax(0.0, currentClose - candidateTop)
                        : MathMax(0.0, candidateBottom - currentClose);
      if(!hasBestCandidate || distance < bestDistance)
      {
         bestCount = count;
         bestCenter = candidateCenter;
         bestOldestShift = oldestShift;
         bestDistance = distance;
         hasBestCandidate = true;
      }
   }

   if(bestCount < MinZoneReactions)
   {
      Log("sin zona historica con suficientes reacciones separadas");
      return false;
   }
   z.dir = allowedDir;
   z.dir = allowedDir;
   SetWickZoneBounds(bestCenter, tolerance, z.top, z.bottom);
   z.startTime = r[bestOldestShift].time;
   z.reactions = bestCount;
   z.trendSetup = false;
   z.breakLevel = 0;
   z.rejectionConfirmed = false;
   z.chochConfirmed = false;
   z.retestConfirmed = false;
   z.t = r[1].time;
   z.age = 0;
   Log(StringFormat("zona con %d reacciones armada; entrada al primer toque",
                    z.reactions));
   return true;
}

bool FindTrendPullbackZone(const MqlRates &r[], const int n, const double atr, SMCZone &z)
{
   double H[], L[];
   ArrayResize(H, n);
   ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, n, hi, lo);
   if(ArraySize(hi) == 0 || ArraySize(lo) == 0)
   {
      RemoveWatchLevel();
      Log("estructura local insuficiente para ubicar un swing");
      return false;
   }

   int pivots[];
   if(allowedDir > 0) ArrayCopy(pivots, lo);
   else               ArrayCopy(pivots, hi);

   int pivotShift = -1;
   double center = 0;
   double tolerance = ZoneToleranceATR * atr;
   for(int p = 0; p < ArraySize(pivots); p++)
   {
      int candidate = pivots[p];
      if(candidate <= SwingStrength || candidate > ReactionLookbackBars) continue;

      double candidateCenter = (allowedDir > 0) ? L[candidate] : H[candidate];
      double candidateTop, candidateBottom;
      SetWickZoneBounds(candidateCenter, tolerance, candidateTop, candidateBottom);
      bool invalidated = false;
      for(int s = 1; s < candidate; s++)
      {
         if((allowedDir > 0 && r[s].close < candidateBottom) ||
            (allowedDir < 0 && r[s].close > candidateTop))
         {
            invalidated = true;
            break;
         }
      }
      if(invalidated) continue;

      // Swings are ordered newest-first; use the latest valid one, not the
      // most extreme old pivot that price may no longer retest.
      pivotShift = candidate;
      center = candidateCenter;
      break;
   }

   if(pivotShift < 0)
   {
      RemoveWatchLevel();
      Log("no hay un swing reciente valido para zona de retesteo");
      return false;
   }
   z.dir = allowedDir;
   SetWickZoneBounds(center, tolerance, z.top, z.bottom);
   z.startTime = r[pivotShift].time;
   z.reactions = 1;
   z.trendSetup = true;
   z.breakLevel = 0;
   z.rejectionConfirmed = false;
   z.chochConfirmed = false;
   z.retestConfirmed = false;

   DrawWatchLevel(z, allowedDir > 0 ? "soporte potencial; Boom busca spike alcista" :
                                     "resistencia potencial; Crash busca spike bajista");

   int latestTouch = -1;
   int touchLimit = (int)MathMin(pivotShift - 1, ZoneMaxAgeBars);
   for(int touchShift = 1; touchShift <= touchLimit; touchShift++)
   {
      bool touched = (allowedDir > 0)
                     ? r[touchShift].low <= z.top && r[touchShift].close >= z.bottom
                     : r[touchShift].high >= z.bottom && r[touchShift].close <= z.top;
      if(touched)
      {
         latestTouch = touchShift;
         break;
      }
   }

   if(latestTouch < 0)
   {
      Log(allowedDir > 0 ? "soporte potencial marcado; esperando retroceso al swing" :
                           "resistencia potencial marcada; esperando retroceso al swing");
      return false;
   }

   if(latestTouch == 1 && IsZoneRejection(r[1], z))
   {
      z.breakLevel = (z.top + z.bottom) / 2.0;
      z.rejectionConfirmed = true;
      z.t = r[1].time;
      z.age = 0;
      Log("rechazo en swing confirmado; preparado para entrada automatica");
      return true;
   }

   if(latestTouch + MinPullbackBars >= n)
   {
      Log("toque detectado, pero no hay suficientes velas para validar el retroceso");
      return false;
   }

   int directionalBars = 0;
   for(int s = latestTouch + 1; s <= latestTouch + MinPullbackBars; s++)
   {
      bool movedTowardZone = (allowedDir > 0) ? r[s].close > r[s-1].close
                                              : r[s].close < r[s-1].close;
      if(movedTowardZone) directionalBars++;
   }
   int requiredBars = (int)MathCeil(MinPullbackBars * MinPullbackDirectionalPct / 100.0);
   double startClose = r[latestTouch + MinPullbackBars].close;
   double currentClose = r[latestTouch].close;
   bool enoughDistance = (allowedDir > 0)
                         ? startClose - z.top >= PullbackMinDistanceATR * atr
                         : z.bottom - startClose >= PullbackMinDistanceATR * atr;
   bool retraced = (allowedDir > 0) ? currentClose < startClose : currentClose > startClose;
   if(!enoughDistance || !retraced || directionalBars < requiredBars)
   {
      DrawWatchLevel(z, allowedDir > 0 ? "soporte tocado; retroceso aun no validado" :
                                        "resistencia tocada; retroceso aun no validado");
      Log("swing tocado, pero el retroceso aun no cumple duracion y recorrido");
      return false;
   }

   z.t = r[latestTouch].time;
   z.age = latestTouch - 1;
   return true;
}

bool DetectLocalChoch(const MqlRates &r[], const int n, const int touchShift, double &breakLevel)
{
   double H[], L[];
   ArrayResize(H, n);
   ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, n, hi, lo);
   if(allowedDir > 0)
   {
      for(int h = 0; h < ArraySize(hi); h++)
      {
         int highShift = hi[h];
         if(highShift <= touchShift) continue;
         for(int l = 0; l < ArraySize(lo); l++)
         {
            int lowShift = lo[l];
            if(lowShift <= 1 || lowShift >= touchShift) continue;

            for(int b = 1; b < lowShift; b++)
            {
               if(r[b].close > H[highShift] && r[b+1].close <= H[highShift])
               {
                  breakLevel = H[highShift];
                  return true;
               }
            }
         }
      }
   }
   else
   {
      for(int l = 0; l < ArraySize(lo); l++)
      {
         int lowShift = lo[l];
         if(lowShift <= touchShift) continue;
         for(int h = 0; h < ArraySize(hi); h++)
         {
            int highShift = hi[h];
            if(highShift <= 1 || highShift >= touchShift) continue;

            for(int b = 1; b < highShift; b++)
            {
               if(r[b].close < L[lowShift] && r[b+1].close >= L[lowShift])
               {
                  breakLevel = L[lowShift];
                  return true;
               }
            }
         }
      }
   }
   return false;
}

void ScanForZones()
{
   int existingZones = ArraySize(zones);
   for(int i = 0; i < existingZones; i++)
      if(!zones[i].trendSetup && zones[i].reactions >= MinZoneReactions)
         return;

   double atr = GetATR(2);
   if(atr <= 0)
   {
      gWhy[allowedDir > 0 ? 0 : 1] = "ATR no disponible";
      return;
   }

   int n = MathMax(VisBars, ReactionLookbackBars + SwingStrength + 5);
   n = MathMax(n, MinPullbackBars + SwingStrength + 5);
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n)
   {
      gWhy[allowedDir > 0 ? 0 : 1] = "historial insuficiente para analizar reacciones";
      return;
   }

   SMCZone z;
   gCurDir = allowedDir;
   bool foundReactionZone = FindReactionZone(r, n, atr, z);
   if(!foundReactionZone && existingZones > 0) return;
   if(!foundReactionZone && !FindTrendPullbackZone(r, n, atr, z))
      return;

   if(foundReactionZone)
      for(int i = ArraySize(zones) - 1; i >= 0; i--)
         RemoveZone(i);

   RemoveWatchLevel();
   gWhy[allowedDir > 0 ? 0 : 1] = "";
   int k = ArraySize(zones);
   ArrayResize(zones, k + 1);
   zones[k] = z;
   DrawZone(z);
   if(z.rejectionConfirmed)
      PrintFormat("[SMC CB] Rechazo confirmado en %s %.5f-%.5f; preparando entrada %s",
                  allowedDir > 0 ? "SOPORTE" : "RESISTENCIA", z.bottom, z.top,
                  allowedDir > 0 ? "BUY" : "SELL");
   else if(!z.trendSetup)
      PrintFormat("[SMC CB] Zona %s %.5f - %.5f (%d reacciones); esperando primer toque para entrar %s",
                  allowedDir > 0 ? "SOPORTE" : "RESISTENCIA", z.bottom, z.top, z.reactions,
                  allowedDir > 0 ? "BUY" : "SELL");
   else
      PrintFormat("[SMC CB] Zona %s %.5f - %.5f (%s); retroceso validado, esperando CHoCH %s",
                  allowedDir > 0 ? "SOPORTE" : "RESISTENCIA", z.bottom, z.top,
                  "tendencia local",
                  allowedDir > 0 ? "alcista" : "bajista");
}

//===================== EJECUCION (sin CTrade) =====================//
int gLastRetcode = 0;
string gLastOrderFailure = "";
bool gLastOrderSendAttempted = false;

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
   ResetLastError();
   bool sent = OrderSend(req, res);
   int error = GetLastError();
   gLastRetcode = (int)res.retcode;
   bool accepted = sent && (res.retcode == TRADE_RETCODE_DONE ||
                            res.retcode == TRADE_RETCODE_DONE_PARTIAL ||
                            res.retcode == TRADE_RETCODE_PLACED);
   if(!accepted)
   {
      gLastOrderFailure = StringFormat("OrderSend sent=%s retcode=%u error=%d comentario=%s",
                                       sent ? "si" : "no", res.retcode, error, res.comment);
      PrintFormat("[SMC CB] Orden rechazada: symbol=%s action=%d type=%d price=%.5f volume=%.3f retcode=%u error=%d comentario=%s",
                  req.symbol, (int)req.action, (int)req.type, req.price, req.volume,
                  res.retcode, error, res.comment);
   }
   else
      gLastOrderFailure = "";
   return accepted;
}

bool CancelOurPendingOrders()
{
   gVirt.active = false;
   bool allRemoved = true;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if((long)OrderGetInteger(ORDER_MAGIC) != MagicNumber) continue;

      MqlTradeRequest req;
      ZeroMemory(req);
      req.action = TRADE_ACTION_REMOVE;
      req.order = ticket;
      req.symbol = _Symbol;
      req.magic = (ulong)MagicNumber;
      if(!SendReq(req)) allRemoved = false;
   }
   return allRemoved && CountOurPendingOrders() == 0;
}

//---- Zonas de rebote en contra (techos para Boom / pisos para Crash) ----
double   gOppLevels[];
datetime gOppBar = 0;
int      gOppDir = 0;

void RefreshOpposingLevels(const int dir)
{
   datetime bar = iTime(_Symbol, _Period, 0);
   if(bar == gOppBar && dir == gOppDir) return;
   gOppBar = bar;
   gOppDir = dir;
   ArrayResize(gOppLevels, 0);

   double atr = GetATR(1);
   if(atr <= 0) return;
   int n = OpposingLookbackBars + SwingStrength + 5;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) return;
   double H[], L[];
   ArrayResize(H, n); ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }
   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, n, hi, lo);

   double tol = OpposingToleranceATR * atr;
   double minBounce = MinOpposingBounceATR * atr;
   int cnt = (dir > 0) ? ArraySize(hi) : ArraySize(lo);
   for(int i = 0; i < cnt; i++)
   {
      int s = (dir > 0) ? hi[i] : lo[i];
      if(s <= SwingStrength || s > OpposingLookbackBars) continue;
      double level = (dir > 0) ? H[s] : L[s];

      // rebote en contra: lo que se alejo del nivel en las velas siguientes
      double extreme = level;
      int from = MathMax(1, s - OpposingReactionBars);
      for(int k = s - 1; k >= from; k--)
         extreme = (dir > 0) ? MathMin(extreme, L[k]) : MathMax(extreme, H[k]);
      double bounce = (dir > 0) ? level - extreme : extreme - level;
      if(bounce < minBounce) continue;

      // nivel roto: un cierre mas alla (+tolerancia) lo convierte en soporte/resistencia a favor
      bool broken = false;
      for(int k = s - 1; k >= 1; k--)
      {
         if((dir > 0 && r[k].close > level + tol) || (dir < 0 && r[k].close < level - tol))
         { broken = true; break; }
      }
      if(broken) continue;

      int sz = ArraySize(gOppLevels);
      ArrayResize(gOppLevels, sz + 1);
      gOppLevels[sz] = level;
   }
}

// true si 'price' esta llegando (o dentro de) una zona donde el indice ya rebotó en contra.
bool OpposingZoneBlocks(const int dir, const double price, string &why)
{
   if(!BlockEntriesIntoOpposingZone) return false;
   double atr = GetATR(1);
   if(atr <= 0) return false;
   RefreshOpposingLevels(dir);

   double band = OpposingZoneATR * atr;
   double tol  = OpposingToleranceATR * atr;
   for(int i = 0; i < ArraySize(gOppLevels); i++)
   {
      double lv = gOppLevels[i];
      bool inZone = (dir > 0) ? (price >= lv - band && price <= lv + tol)
                              : (price <= lv + band && price >= lv - tol);
      if(inZone)
      {
         why = StringFormat("%s bloqueada: precio %.5f llegando a zona de rebote en contra %.5f (%.2f ATR)",
                            dir > 0 ? "compra" : "venta", price, lv, MathAbs(lv - price) / atr);
         return true;
      }
   }
   return false;
}

//---- Rigor: filtros de calidad previos a cualquier entrada ----
bool LossGuardBlocks(string &why)
{
   if(CooldownBarsAfterLoss <= 0 && MaxConsecutiveLossesDay <= 0) return false;
   MqlDateTime d;
   TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   if(!HistorySelect(StructToTime(d), TimeCurrent() + 86400)) return false;

   int total = HistoryDealsTotal();

   // Paso 1: posiciones abiertas por este EA (el deal de cierre por SL puede no heredar el Magic)
   ulong ourPos[];
   for(int i = 0; i < total; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      if((long)HistoryDealGetInteger(tk, DEAL_MAGIC) != MagicNumber) continue;
      int n = ArraySize(ourPos);
      ArrayResize(ourPos, n + 1);
      ourPos[n] = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
   }

   // Paso 2: cierres en orden cronologico
   int streak = 0;                       // racha global (o del simbolo si GlobalRiskGuard=false)
   bool lastSymWasLoss = false;          // ultimo cierre de ESTE simbolo
   datetime lastSymTime = 0;
   for(int i = 0; i < total; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      long type = HistoryDealGetInteger(tk, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) continue;

      bool ours = ((long)HistoryDealGetInteger(tk, DEAL_MAGIC) == MagicNumber);
      if(!ours)
      {
         ulong pid = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
         for(int k = 0; k < ArraySize(ourPos); k++)
            if(ourPos[k] == pid) { ours = true; break; }
      }
      if(!ours) continue;

      bool sameSym = (HistoryDealGetString(tk, DEAL_SYMBOL) == _Symbol);
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) +
                 HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
      bool loss = (p < 0);

      if(sameSym)
      {
         lastSymWasLoss = loss;
         lastSymTime = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
      }
      if(GlobalRiskGuard || sameSym)
         streak = loss ? streak + 1 : 0;
   }
   if(MaxConsecutiveLossesDay > 0 && streak >= MaxConsecutiveLossesDay)
   {
      why = StringFormat("%d perdidas seguidas hoy%s: EA en pausa hasta el proximo dia", streak,
                         GlobalRiskGuard ? " (todos los indices)" : "");
      return true;
   }
   if(CooldownBarsAfterLoss > 0 && lastSymWasLoss && lastSymTime > 0)
   {
      int sh = iBarShift(_Symbol, _Period, lastSymTime, false);
      if(sh >= 0 && sh < CooldownBarsAfterLoss)
      {
         why = StringFormat("pausa tras perdida: %d de %d velas", sh, CooldownBarsAfterLoss);
         return true;
      }
   }
   return false;
}

bool PostSpikeBlocks(const int dir, string &why)
{
   if(PostSpikeWaitBars <= 0) return false;
   double atr = GetATR(1);
   if(atr <= 0) return false;
   for(int s = 1; s <= PostSpikeWaitBars; s++)
   {
      double o = iOpen(_Symbol, _Period, s);
      double move = (dir > 0) ? iHigh(_Symbol, _Period, s) - o : o - iLow(_Symbol, _Period, s);
      if(move >= PostSpikeATR * atr)
      {
         why = StringFormat("spike de %.1f ATR hace %d velas: se espera para no perseguir el extremo", move / atr, s);
         return true;
      }
   }
   return false;
}

bool BiasAgainstBlocks(const int dir, string &why)
{
   if(!RequireBiasNotAgainst || BiasMode == 0) return false;
   UpdateBias();
   if(biasDir == -dir)
   {
      why = "sesgo del TF superior en contra de la operacion";
      return true;
   }
   return false;
}

bool RangePositionBlocks(const int dir, const double price, string &why)
{
   if(!RequireDiscountPremium) return false;
   double hh = -DBL_MAX, ll = DBL_MAX;
   for(int s = 1; s <= RangePositionLookback; s++)
   {
      hh = MathMax(hh, iHigh(_Symbol, _Period, s));
      ll = MathMin(ll, iLow(_Symbol, _Period, s));
   }
   double range = hh - ll;
   if(range <= 0) return false;
   double pos = (price - ll) / range * 100.0;      // 0 = minimo del rango, 100 = maximo
   if(dir > 0 && pos > MaxRangePositionPct)
   {
      why = StringFormat("compra en zona cara: %.0f%% del rango (max %.0f%%)", pos, MaxRangePositionPct);
      return true;
   }
   if(dir < 0 && pos < 100.0 - MaxRangePositionPct)
   {
      why = StringFormat("venta en zona barata: %.0f%% del rango (min %.0f%%)", pos, 100.0 - MaxRangePositionPct);
      return true;
   }
   return false;
}

bool EntryQualityBlocks(const int dir, const double price, string &why,
                        const bool ignorePostSpike = false)
{
   if(LossGuardBlocks(why))              return true;
   if(gSpikeEntry)
   {
      // Entrada de retroceso post-spike: la tendencia del grafico ya se valido aparte.
      if(!SpikeIgnoreRangeAndPostSpike)
      {
         if(PostSpikeBlocks(dir, why))            return true;
         if(RangePositionBlocks(dir, price, why)) return true;
      }
      if(!SpikeIgnoreHTFBias && BiasAgainstBlocks(dir, why)) return true;
      return false;
   }
   if(!ignorePostSpike && PostSpikeBlocks(dir, why)) return true;
   if(BiasAgainstBlocks(dir, why))       return true;
   if(RangePositionBlocks(dir, price, why)) return true;
   return false;
}

bool QueueVirtual(const int dir, const double lots, const double price,
                  const double sl, const string cm)
{
   gVirt.active  = true;
   gVirt.dir     = dir;
   gVirt.level   = price;
   gVirt.sl      = sl;
   gVirt.lots    = lots;
   gVirt.cm      = cm;
   gVirt.expires = TimeCurrent() + (datetime)(PeriodSeconds(_Period) * LimitOrderExpiryBars);
   PrintFormat("[SMC CB] Nivel virtual %s armado en %.5f (SL %.5f); entrada a MERCADO al tocar, vigencia %d velas",
               dir > 0 ? "BUY" : "SELL", price, sl, LimitOrderExpiryBars);
   return true;
}

bool OpenLimit(const int dir, const double lots, const double price,
               const double sl, const string cm)
{
   if(UseVirtualLimits) return QueueVirtual(dir, lots, price, sl, cm);
   string capWhy;
   if(!PositionCapAllows(capWhy)) { Print("[SMC CB] Orden limite bloqueada: ", capWhy); return false; }
   if(OpposingZoneBlocks(dir, price, capWhy)) { Print("[SMC CB] Orden limite ", capWhy); return false; }
   if(EntryQualityBlocks(dir, price, capWhy)) { Print("[SMC CB] Orden limite descartada por rigor: ", capWhy); return false; }
   long expirationMode = SymbolInfoInteger(_Symbol, SYMBOL_EXPIRATION_MODE);
   if((expirationMode & SYMBOL_EXPIRATION_SPECIFIED) == 0)
   {
      Print("[SMC CB] No se coloca la orden limite: el broker no admite expiracion especificada.");
      return false;
   }

   MqlTradeRequest req;
   ZeroMemory(req);
   req.action       = TRADE_ACTION_PENDING;
   req.symbol       = _Symbol;
   req.volume       = lots;
   req.type         = (dir > 0) ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
   req.price        = price;
   req.sl           = sl;
   req.tp           = 0.0;
   req.deviation    = (ulong)DeviationPoints;
   req.magic        = (ulong)MagicNumber;
   req.comment      = cm;
   req.type_time    = ORDER_TIME_SPECIFIED;
   req.expiration   = TimeCurrent() + (datetime)(PeriodSeconds(_Period) * LimitOrderExpiryBars);
   req.type_filling = ORDER_FILLING_RETURN;
   return SendReq(req);
}

bool OpenMarket(const int dir, const double lots, const double price,
                const double sl, const string cm, const bool ignorePostSpike = false)
{
   gLastRetcode = 0;
   gLastOrderFailure = "";
   gLastOrderSendAttempted = false;
   string capWhy;
   if(!PositionCapAllows(capWhy))
   {
      gLastOrderFailure = capWhy;
      static datetime lastCapLog = 0;
      datetime cb = iTime(_Symbol, _Period, 0);
      if(cb != lastCapLog) { Print("[SMC CB] Entrada MARKET bloqueada: ", capWhy); lastCapLog = cb; }
      return false;
   }
   if(OpposingZoneBlocks(dir, price, capWhy))
   {
      gLastOrderFailure = capWhy;
      static datetime lastOppLog = 0;
      datetime ob = iTime(_Symbol, _Period, 0);
      if(ob != lastOppLog) { Print("[SMC CB] Entrada MARKET ", capWhy); lastOppLog = ob; }
      Log(capWhy);
      return false;
   }
   if(EntryQualityBlocks(dir, price, capWhy, ignorePostSpike))
   {
      gLastOrderFailure = capWhy;
      static datetime lastQualLog = 0;
      datetime qb = iTime(_Symbol, _Period, 0);
      if(qb != lastQualLog) { Print("[SMC CB] Entrada MARKET descartada por rigor: ", capWhy); lastQualLog = qb; }
      Log(capWhy);
      return false;
   }
   MqlTradeRequest req;
   ZeroMemory(req);
   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = _Symbol;
   req.volume       = lots;
   req.type         = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price        = price;
   req.sl           = sl;
   req.tp           = 0.0;
   req.deviation    = (ulong)DeviationPoints;
   req.magic        = (ulong)MagicNumber;
   req.comment      = cm;
   req.type_filling = GetFilling();
   gLastOrderSendAttempted = true;
   return SendReq(req);
}

double UpdateApproachVelocity(const MqlTick &tick)
{
   if(tick.time_msc <= 0) return 0;

   long sampleSecond = tick.time_msc / 1000;
   if(sampleSecond != approachLastSampleSecond)
   {
      approachPrices[approachNextSample] = (tick.bid + tick.ask) / 2.0;
      approachTimes[approachNextSample] = tick.time_msc;
      approachNextSample = (approachNextSample + 1) % 16;
      approachSampleCount++;
      if(approachSampleCount > 16) approachSampleCount = 16;
      approachLastSampleSecond = sampleSecond;
   }

   long cutoff = tick.time_msc - 15000;
   long oldest = tick.time_msc;
   int count = 0;
   double sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
   for(int i = 0; i < approachSampleCount; i++)
   {
      if(approachTimes[i] < cutoff || approachTimes[i] > tick.time_msc) continue;
      if(approachTimes[i] < oldest) oldest = approachTimes[i];
      count++;
   }
   if(count < 6 || tick.time_msc - oldest < 8000) return 0;

   for(int i = 0; i < approachSampleCount; i++)
   {
      if(approachTimes[i] < cutoff || approachTimes[i] > tick.time_msc) continue;
      double x = (double)(approachTimes[i] - oldest) / 1000.0;
      double y = approachPrices[i];
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
   }

   double denominator = count * sumXX - sumX * sumX;
   if(denominator <= 0) return 0;
   return (count * sumXY - sumX * sumY) / denominator;
}

bool WasLineTriggered(const string key)
{
   for(int i = 0; i < ArraySize(triggeredLineKeys); i++)
      if(triggeredLineKeys[i] == key) return true;
   return false;
}

bool WasWideStopWarningShown(const string key)
{
   for(int i = 0; i < ArraySize(wideStopWarningKeys); i++)
      if(wideStopWarningKeys[i] == key) return true;
   return false;
}

void RememberWideStopWarning(const string key)
{
   int size = ArraySize(wideStopWarningKeys);
   ArrayResize(wideStopWarningKeys, size + 1);
   wideStopWarningKeys[size] = key;
}

bool WasOBZoneRegistered(const string key)
{
   for(int i = 0; i < ArraySize(touchedOBZones); i++)
      if(touchedOBZones[i].key == key) return true;
   return false;
}

void RegisterTouchedOB(const int dir, const double top, const double bottom,
                       const datetime formedAt)
{
   string key = StringFormat("OB_%d_%I64d_%s_%s", dir, (long)formedAt,
                             DoubleToString(top, _Digits),
                             DoubleToString(bottom, _Digits));
   if(WasOBZoneRegistered(key)) return;

   int size = ArraySize(touchedOBZones);
   ArrayResize(touchedOBZones, size + 1);
   touchedOBZones[size].dir = dir;
   touchedOBZones[size].top = top;
   touchedOBZones[size].bottom = bottom;
   touchedOBZones[size].key = key;
}

void RememberTriggeredLine(const string key)
{
   int size = ArraySize(triggeredLineKeys);
   ArrayResize(triggeredLineKeys, size + 1);
   triggeredLineKeys[size] = key;
}

bool TryEnterBeforeLine(const double level, const string key, const double price,
                        const double velocity, const bool allowEntry,
                        const bool allowBrokerMinStop = false, const bool atTouch = false)
{
   if(WasLineTriggered(key)) return false;

   double etaSeconds = 0;
   if(!atTouch)
   {
      double distance = level - price;
      if(distance * velocity <= 0) return false;

      etaSeconds = distance / velocity;
      if(etaSeconds <= 0 || etaSeconds > 120.0) return false;
   }
   if(!EnableAutoTrading || !allowEntry) return false;

   gCurDir = allowedDir;
   double atr = GetATR(1);
   if(atr <= 0)
   {
      Log("linea a menos de 2 minutos, pero ATR no disponible para calcular el stop");
      return false;
   }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
   {
      Log("linea a menos de 2 minutos, pero no se pudo leer el precio actual");
      return false;
   }

   double entry = (allowedDir > 0) ? tick.ask : tick.bid;
   double spread = tick.ask - tick.bid;
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double slDist = MathMax(MathMax(SLBufferATR, MinSL_ATR) * atr, minStop + spread);
   if(slDist > MaxSL_ATR * atr && !allowBrokerMinStop)
   {
      Log("entrada anticipada bloqueada: stop minimo del broker supera el maximo en ATR");
      return false;
   }
   if(slDist > MaxSL_ATR * atr && !WasWideStopWarningShown(key))
   {
      PrintFormat("[SMC CB] Aviso: entrada de zona usa SL %.5f (%.2f ATR), mayor al maximo configurado %.2f ATR por requisito del broker.",
                  slDist, slDist / atr, MaxSL_ATR);
      RememberWideStopWarning(key);
   }

   double sl = (allowedDir > 0) ? entry - slDist : entry + slDist;
   if(!ApplyTenMinuteStop(allowedDir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
      return false;
   slDist = MathAbs(entry - sl);
   bool brokerMinimumOnly = allowBrokerMinStop &&
                            minStop + spread > MaxSL_ATR * atr &&
                            slDist <= minStop + spread + _Point;
   if(slDist > MaxSL_ATR * atr && !brokerMinimumOnly)
   {
      Log("entrada anticipada bloqueada: SL de 10 minutos supera el maximo en ATR");
      return false;
   }
   if(brokerMinimumOnly && !WasWideStopWarningShown(key))
   {
      PrintFormat("[SMC CB] Aviso: SL %.5f supera MaxSL_ATR solo por la distancia minima exigida por el broker.",
                  slDist);
      RememberWideStopWarning(key);
   }
   double maxSpread = MaxSpreadPctSL / 100.0 * slDist;
   if(!atTouch && spread > maxSpread)
   {
      Log("entrada anticipada bloqueada: spread vs SL alto");
      return false;
   }
   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);
   double lots = CalcLots(allowedDir, entry, sl);
   if(lots <= 0) return false;

   string comment = atTouch
                    ? (allowedDir > 0 ? "SMC OB Touch BUY" : "SMC OB Touch SELL")
                    : (allowedDir > 0 ? "SMC PreLine BUY" : "SMC PreLine SELL");
   gLastOrderFailure = "";
   gLastOrderSendAttempted = false;
   bool opened = OpenMarket(allowedDir, lots, entry, sl, comment);
   string result = opened ? "EJECUTADA" :
                   (gLastOrderSendAttempted ? "ORDEN RECHAZADA: " : "BLOQUEADA LOCALMENTE: ");
   if(!opened)
      result += gLastOrderFailure == "" ? "causa no especificada" : gLastOrderFailure;
   if(atTouch)
      PrintFormat("[SMC CB] Entrada MARKET %s al tocar OB %.5f: precio %.5f, SL %.5f (%.2f ATR), lote %.2f -> %s",
                  allowedDir > 0 ? "BUY" : "SELL", level, entry, sl, slDist / atr, lots, result);
   else
      PrintFormat("[SMC CB] Entrada anticipada %s antes de linea %.5f: ETA %.0f s, precio %.5f, SL %.5f, lote %.2f -> %s",
                  allowedDir > 0 ? "BUY" : "SELL", level, etaSeconds, entry, sl, lots, result);
   if(opened) RememberTriggeredLine(key);
   return opened;
}

void CheckAnticipatedLineEntry(const bool allowEntry)
{
   if(!EnableAnticipatedLineEntries) return;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return;
   double price = (tick.bid + tick.ask) / 2.0;
   double velocity = UpdateApproachVelocity(tick);
   bool hasVelocity = MathAbs(velocity) >= _Point * 0.1;

   if(hasVelocity && hasAnticipatedWatchLevel)
   {
      string key = WatchLineName() + ":" + DoubleToString(anticipatedWatchLevel, _Digits);
      if(TryEnterBeforeLine(anticipatedWatchLevel, key, price, velocity, allowEntry))
         return;
   }

   for(int i = 0; hasVelocity && i < ArraySize(zones); i++)
   {
      if(!zones[i].chochConfirmed || zones[i].retestConfirmed) continue;
      string key = ZoneName(zones[i]) + "_R:" + DoubleToString(zones[i].breakLevel, _Digits);
      if(TryEnterBeforeLine(zones[i].breakLevel, key, price, velocity, allowEntry))
         return;
   }

   for(int i = 0; i < ArraySize(touchedOBZones); i++)
   {
      if(touchedOBZones[i].dir != allowedDir) continue;

      double entryLine = (allowedDir > 0) ? touchedOBZones[i].top
                                          : touchedOBZones[i].bottom;
      bool touchingZone = price >= touchedOBZones[i].bottom &&
                          price <= touchedOBZones[i].top;
      if(touchingZone &&
         TryEnterBeforeLine(entryLine, touchedOBZones[i].key, price, velocity,
                            CanTradeNow(false, AllowAdditionalOBTouchPositions),
                            AllowAdditionalOBTouchPositions, true))
         return;

      bool approachingFromOutside = hasVelocity &&
                                   ((allowedDir > 0)
                                    ? price > touchedOBZones[i].top && velocity < 0
                                    : price < touchedOBZones[i].bottom && velocity > 0);
      if(approachingFromOutside &&
         TryEnterBeforeLine(entryLine, touchedOBZones[i].key, price, velocity,
                            allowEntry, true))
         return;
   }
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

//========================= RIESGO / ENTRADA =======================//
double CalcLots(const int dir, const double entry, const double sl)
{
   if(dir != allowedDir || (dir > 0 && sl >= entry) || (dir < 0 && sl <= entry))
   {
      Log("direccion o stop invalido para el indice");
      return 0;
   }
   ENUM_ORDER_TYPE ot = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double lots = FixedLotSize;
   double volumeMin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double volumeStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   int volumeDigits = 0;
   double scaledStep = volumeStep;
   while(volumeDigits < 8 && MathAbs(scaledStep - MathRound(scaledStep)) > 1e-8)
   {
      scaledStep *= 10.0;
      volumeDigits++;
   }

   if(MaxLossPerTradeUSD > 0)
   {
      double pnl = 0;
      if(!OrderCalcProfit(ot, _Symbol, lots, entry, sl, pnl))
      {
         Print("[SMC CB] No se pudo calcular la perdida estimada al SL. Error=", GetLastError());
         return 0;
      }

      double estimatedLoss = MathMax(0.0, -pnl);
      if(estimatedLoss > MaxLossPerTradeUSD)
      {
         lots = MathFloor((FixedLotSize * MaxLossPerTradeUSD / estimatedLoss) /
                          volumeStep + 1e-8) * volumeStep;
         lots = NormalizeDouble(lots, volumeDigits);

         while(lots >= volumeMin)
         {
            if(!OrderCalcProfit(ot, _Symbol, lots, entry, sl, pnl))
            {
               Print("[SMC CB] No se pudo validar el riesgo del lote ajustado. Error=", GetLastError());
               return 0;
            }
            if(-pnl <= MaxLossPerTradeUSD)
               break;
            lots = NormalizeDouble(lots - volumeStep, volumeDigits);
         }

         if(lots < volumeMin)
         {
            double minLotPnl = 0;
            if(!OrderCalcProfit(ot, _Symbol, volumeMin, entry, sl, minLotPnl))
            {
               Print("[SMC CB] No se pudo validar el riesgo del lote minimo. Error=", GetLastError());
               return 0;
            }
            Log(StringFormat("entrada descartada: el lote minimo %.3f arriesga %.2f, supera el limite %.2f",
                             volumeMin, -minLotPnl, MaxLossPerTradeUSD));
            return 0;
         }
      }
   }

   double margin = 0;
   if(!OrderCalcMargin(ot, _Symbol, lots, entry, margin))
   {
      Print("[SMC CB] No se pudo calcular el margen requerido. Error=", GetLastError());
      return 0;
   }
   if(margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.8)
   {
      Log(StringFormat("margen libre insuficiente para el lote %.3f", lots));
      return 0;
   }
   return lots;
}

//==================== v2.08: SPIKE + RETROCESO ====================//
// Idea: si el indice esta en tendencia (Crash a la baja / Boom al alza) y se
// produce un spike a favor, NO se persigue. Se espera el retroceso y se entra
// a mercado cuando el precio recupera SpikeRetracementPct (50% = mitad) del
// spike. SL mas alla del origen del spike. Aplica a todo Boom/Crash (300/500/1000).

int SpikeIndexNumber()
{
   string sym = _Symbol;
   int n = StringLen(sym);
   for(int i = 0; i < n; i++)
   {
      ushort c = StringGetCharacter(sym, i);
      if(c >= '0' && c <= '9')
      {
         int v = 0;
         while(i < n)
         {
            c = StringGetCharacter(sym, i);
            if(c < '0' || c > '9') break;
            v = v * 10 + (int)(c - '0');
            i++;
         }
         return v;
      }
   }
   return 0;
}

int SpikeWaitBars()
{
   double w = SpikeMaxWaitBars;
   if(SpikeScaleWaitByIndex)
   {
      int idx = SpikeIndexNumber();
      if(idx > 300) w = w * idx / 300.0;
   }
   return (int)MathCeil(w);
}

void SpikeClear(const bool markDone)
{
   if(markDone && spikeKey != 0) spikeDoneKey = spikeKey;
   spikeRetracementPending = false;
   ObjectDelete(0, "SMC_SPK_LVL");
}

void DrawSpikeLevel(const double level)
{
   if(!DrawObjects) return;
   string nm = "SMC_SPK_LVL";
   if(ObjectFind(0, nm) < 0)
   {
      ObjectCreate(0, nm, OBJ_HLINE, 0, 0, level);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, clrOrange);
      ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DASH);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, nm, OBJPROP_TEXT, "entrada " + DoubleToString(SpikeRetracementPct, 0) + "% spike");
   }
   ObjectSetDouble(0, nm, OBJPROP_PRICE, level);
}

// Spike = velas consecutivas (max 3) en la direccion del indice. La vela en
// formacion se ignora si va en contra (es el retroceso en curso).
bool DetectSpikeRun(const int dir, double &originOpen, double &extreme, double &slRef,
                    datetime &key, double &atr)
{
   double hi = -DBL_MAX, lo = DBL_MAX;
   int n = 0, oldest = 0;
   for(int s = 0; s <= 3; s++)
   {
      double o = iOpen(_Symbol, _Period, s), c = iClose(_Symbol, _Period, s);
      if(o <= 0) break;
      bool inDir = (dir > 0) ? (c > o) : (c < o);
      if(!inDir)
      {
         if(s == 0) continue;           // retroceso en curso en la vela actual
         break;
      }
      hi = MathMax(hi, iHigh(_Symbol, _Period, s));
      lo = MathMin(lo, iLow(_Symbol, _Period, s));
      n++;
      oldest = s;
   }
   if(n == 0) return false;
   atr = GetATR(oldest + 1);                 // ATR previo al spike (no inflado por el)
   if(atr <= 0) atr = GetATR(1);
   if(atr <= 0) return false;
   originOpen = iOpen(_Symbol, _Period, oldest);
   key = iTime(_Symbol, _Period, oldest);
   double size;
   if(dir > 0) { extreme = hi; slRef = lo; size = hi - originOpen; }
   else        { extreme = lo; slRef = hi; size = originOpen - lo; }
   return (size >= SpikeEntryATR * atr);
}

// Tendencia del grafico a favor: Crash = LH + LL (el spike cuenta como LL), Boom = HL + HH.
bool SpikeTrendOK(const int dir, const double extreme, string &why)
{
   if(!SpikeRequireTrend) return true;
   int n = SpikeTrendLookback;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) { why = "historial insuficiente para medir tendencia"; return false; }
   double H[], L[];
   ArrayResize(H, n); ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }
   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, 3, hi, lo);
   if(ArraySize(hi) < 2 || ArraySize(lo) < 2) { why = "pocos swings para medir tendencia"; return false; }
   if(dir < 0)
   {
      bool lowerHigh = H[hi[0]] < H[hi[1]];
      bool lowerLow  = (L[lo[0]] < L[lo[1]]) || (extreme < L[lo[0]]);
      if(lowerHigh && lowerLow) return true;
      why = StringFormat("sin tendencia bajista en el grafico (LH=%s LL=%s)", lowerHigh ? "si" : "no", lowerLow ? "si" : "no");
      return false;
   }
   bool higherLow  = L[lo[0]] > L[lo[1]];
   bool higherHigh = (H[hi[0]] > H[hi[1]]) || (extreme > H[hi[0]]);
   if(higherLow && higherHigh) return true;
   why = StringFormat("sin tendencia alcista en el grafico (HL=%s HH=%s)", higherLow ? "si" : "no", higherHigh ? "si" : "no");
   return false;
}

void CheckSpikeImpulseEntry()
{
   if(!EnableSpikeImpulseEntries) return;
   const int dir = allowedDir;
   if(dir == 0) return;

   //--- 1) detectar / actualizar el spike
   double originOpen, extreme, slRef, atr;
   datetime key;
   if(DetectSpikeRun(dir, originOpen, extreme, slRef, key, atr) && key != spikeDoneKey)
   {
      if(!spikeRetracementPending || key != spikeKey)
      {
         spikeKey = key;
         spikeRetracementPending = true;
         PrintFormat("[SMC CB] Spike %s detectado: %.2f ATR. Esperando retroceso al %.0f%% (max %d velas)",
                     dir > 0 ? "alcista Boom" : "bajista Crash",
                     MathAbs(extreme - originOpen) / atr, SpikeRetracementPct, SpikeWaitBars());
      }
      pendingSpikeOrigin  = originOpen;
      pendingSpikeExtreme = extreme;
      pendingSpikeSLRef   = slRef;
      pendingSpikeATR     = atr;
      pendingSpikeBar     = key;
      pendingSpikeEntry   = originOpen + (extreme - originOpen) * SpikeRetracementPct / 100.0;
      DrawSpikeLevel(pendingSpikeEntry);
   }
   if(!spikeRetracementPending) return;
   gCurDir = dir;

   //--- 2) vigencia
   int age = iBarShift(_Symbol, _Period, pendingSpikeBar, false);
   if(age < 0 || age > SpikeWaitBars())
   {
      Print("[SMC CB] Spike sin retroceso al nivel dentro del plazo; se descarta.");
      SpikeClear(true);
      return;
   }
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return;
   double range = MathAbs(pendingSpikeExtreme - pendingSpikeOrigin);
   if(range <= 0) return;
   double px = (dir > 0) ? tick.ask : tick.bid;
   double retrace = (dir > 0) ? (pendingSpikeExtreme - px) / range * 100.0
                              : (px - pendingSpikeExtreme) / range * 100.0;
   if(retrace >= SpikeMaxEntryRetracePct)
   {
      PrintFormat("[SMC CB] Spike: el retroceso llego a %.0f%% (max %.0f%%) sin entrada; se descarta.",
                  retrace, SpikeMaxEntryRetracePct);
      SpikeClear(true);
      return;
   }

   //--- 3) nivel tocado?
   double tol = VirtualTouchATR * pendingSpikeATR;
   bool touched = (dir > 0) ? tick.ask <= pendingSpikeEntry + tol
                            : tick.bid >= pendingSpikeEntry - tol;
   if(!touched) return;

   //--- 4) condiciones de entrada
   if(!EnableAutoTrading) { Log("spike: retroceso en el nivel, pero EnableAutoTrading esta desactivado"); return; }
   if(GetTickCount64() - spikeLastTryMs < 1000) return;
   spikeLastTryMs = GetTickCount64();
   if(!CanTradeNow(true))
   {
      Log("spike: retroceso en el nivel, entrada bloqueada por limites operativos (ver motivo arriba)");
      return;
   }
   string why = "";
   if(!SpikeTrendOK(dir, pendingSpikeExtreme, why))
   {
      Log("spike: " + why);
      return;
   }

   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double spread = tick.ask - tick.bid;
   double buf = SpikeSLBufferATR * pendingSpikeATR;
   double entry = (dir > 0) ? tick.ask : tick.bid;
   double sl = (dir > 0) ? pendingSpikeSLRef - buf : pendingSpikeSLRef + buf;
   if(!ApplyTenMinuteStop(dir, entry,
                          MathMax(MinSL_ATR * pendingSpikeATR, minStop + spread), sl))
      return;
   double slDist = MathAbs(sl - entry);
   if(slDist > SpikeMaxSL_ATR * pendingSpikeATR)
   {
      PrintFormat("[SMC CB] Spike: SL de %.2f ATR supera el maximo %.2f ATR; senal descartada.",
                  slDist / pendingSpikeATR, SpikeMaxSL_ATR);
      SpikeClear(true);
      return;
   }
   if(spread > MaxSpreadPctSL / 100.0 * slDist)
   {
      Log(StringFormat("spike: esperando, spread %.5f > maximo %.5f", spread, MaxSpreadPctSL / 100.0 * slDist));
      return;
   }
   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);
   double lots = CalcLots(dir, entry, sl);
   if(lots <= 0)
   {
      Print("[SMC CB] Spike: lote/riesgo no valido (ver MaxLossPerTradeUSD); senal descartada.");
      SpikeClear(true);
      return;
   }

   string comment = (dir > 0) ? "Boom Spike 50% BUY" : "Crash Spike 50% SELL";
   gSpikeEntry = true;
   bool ok = OpenMarket(dir, lots, entry, sl, comment);
   gSpikeEntry = false;
   PrintFormat("[SMC CB] Spike %s: MARKET en retroceso %.0f%% a %.5f (nivel %.5f), extremo %.5f, SL %.5f (%.2f ATR), lote %.2f -> %s (%d)",
               dir > 0 ? "Boom BUY" : "Crash SELL", retrace, entry, pendingSpikeEntry,
               pendingSpikeExtreme, sl, slDist / pendingSpikeATR, lots,
               ok ? "EJECUTADA" : "NO EJECUTADA", gLastRetcode);
   if(ok) SpikeClear(true);
}

bool TryEnter(const SMCZone &z, const bool reactionTouchEntry = false)
{
   if(z.dir != allowedDir) return false;
   double atr = GetATR(1);
   if(atr <= 0) return false;

   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) return false;

   bool structuralRetest = !reactionTouchEntry &&
                           z.chochConfirmed && z.retestConfirmed &&
                           !z.rejectionConfirmed;
   if(structuralRetest)
   {
      double distanceToZone = 0;
      if(z.breakLevel > z.top) distanceToZone = z.breakLevel - z.top;
      else if(z.breakLevel < z.bottom) distanceToZone = z.bottom - z.breakLevel;
      if(distanceToZone > MaxEntryDistanceATR * atr)
      {
         Log("nivel de retesteo estructural demasiado lejos de la zona");
         return false;
      }
   }

   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double spread = t.ask - t.bid;
   double entry = (z.dir > 0) ? t.ask : t.bid;
   double slDist = MathMax(MathMax(SLBufferATR, MinSL_ATR) * atr, minStop + spread);
   double sl = (z.dir > 0) ? entry - slDist : entry + slDist;
   if(!ApplyTenMinuteStop(z.dir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
      return false;
   slDist = MathAbs(entry - sl);
   if(slDist > MaxSL_ATR * atr)
   {
      if(slDist > minStop + spread + _Point)
      {
         Log("entrada de zona bloqueada: SL M1 de 10 minutos supera MaxSL_ATR");
         return false;
      }
      PrintFormat("[SMC CB] Aviso: entrada de zona usa SL %.5f (%.2f ATR), excede MaxSL_ATR solo por el minimo del broker.",
                  slDist, slDist / atr);
   }
   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);

   double maxSpread = MaxSpreadPctSL / 100.0 * slDist;
   if(spread > maxSpread)
   {
      static datetime lastSpreadBlockBar = 0;
      datetime currentBar = iTime(_Symbol, _Period, 0);
      if(currentBar != lastSpreadBlockBar)
      {
         PrintFormat("[SMC CB] Entrada cancelada: spread %.5f > maximo %.5f (%.1f%% del SL)",
                     spread, maxSpread, MaxSpreadPctSL);
         lastSpreadBlockBar = currentBar;
      }
      Log("spread vs SL alto");
      return false;
   }

   double lots = CalcLots(z.dir, entry, sl);
   if(lots <= 0) return false;

   string cm = StringFormat("%s %s MARKET",
                            reactionTouchEntry ? "Reaction Zone Touch" :
                            (structuralRetest ? "CHoCH Retest" : "Zone Rejection"),
                            z.dir > 0 ? "BUY" : "SELL");
   bool ok = OpenMarket(z.dir, lots, entry, sl, cm);
   PrintFormat("[SMC CB] Zona %s MARKET lots=%.2f precio=%.5f SL=%.5f (%.2f ATR) -> %s (%d)",
               z.dir > 0 ? "BUY" : "SELL", lots, entry, sl, slDist / atr,
               ok ? "COLOCADA" : "FALLO", gLastRetcode);
   return ok;
}

bool TryEnterContinuation(const double nExtreme, const double breakLevel)
{
   double atr = GetATR(1);
   if(atr <= 0) return false;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return false;

   double entry = nExtreme;
   double slBuffer = MathMax(SLBufferATR, MinSL_ATR) * atr;
   double sl = (allowedDir > 0) ? entry - slBuffer : entry + slBuffer;
   if(MarketContinuationEntries)
   {
      entry = (allowedDir > 0) ? tick.ask : tick.bid;
      bool breakoutStillValid = (allowedDir > 0) ? entry > breakLevel : entry < breakLevel;
      if(!breakoutStillValid)
      {
         Log("ruptura N revertida antes de ejecutar la entrada al mercado");
         return false;
      }
   }

   double spread = tick.ask - tick.bid;
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(!ApplyTenMinuteStop(allowedDir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
      return false;
   double slDist = MathAbs(entry - sl);
   if(slDist > MaxSL_ATR * atr) { Log("SL de la N supera el maximo"); return false; }

   double maxSpread = MaxSpreadPctSL / 100.0 * slDist;
   if(spread > maxSpread)
   {
      Log("entrada N bloqueada: spread vs SL alto");
      return false;
   }

   if((allowedDir > 0 && ((MarketContinuationEntries && sl >= tick.bid - minStop) ||
                          (!MarketContinuationEntries && entry > tick.bid - minStop) ||
                          entry - sl < minStop)) ||
      (allowedDir < 0 && ((MarketContinuationEntries && sl <= tick.ask + minStop) ||
                          (!MarketContinuationEntries && entry < tick.ask + minStop) ||
                          sl - entry < minStop)))
   {
      Log(MarketContinuationEntries ? "entrada de ruptura al mercado demasiado extendida o SL invalido"
                                    : "orden limite N demasiado cerca del precio o SL invalido");
      return false;
   }

   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);

   double lots = CalcLots(allowedDir, entry, sl);
   if(lots <= 0) return false;

   bool ok;
   if(MarketContinuationEntries)
   {
      string comment = (allowedDir > 0) ? "N Breakout BUY" : "N Breakout SELL";
      ok = OpenMarket(allowedDir, lots, entry, sl, comment);
      PrintFormat("[SMC CB] Patron N %s MARKET lots=%.2f precio=%.5f extremo=%.5f SL=%.5f -> %s (%d)",
                  allowedDir > 0 ? "BUY" : "SELL", lots, entry, nExtreme, sl,
                  ok ? "EJECUTADA" : "FALLO", gLastRetcode);
   }
   else
   {
      string comment = (allowedDir > 0) ? "N Pattern BUY LIMIT" : "N Pattern SELL LIMIT";
      ok = OpenLimit(allowedDir, lots, entry, sl, comment);
      PrintFormat("[SMC CB] Patron N %s LIMIT lots=%.2f extremo=%.5f SL=%.5f TP=off (trailing ATR) expira en %d velas -> %s (%d)",
                  allowedDir > 0 ? "BUY" : "SELL", lots, entry, sl,
                  LimitOrderExpiryBars, ok ? "COLOCADA" : "FALLO", gLastRetcode);
   }
   return ok;
}

bool TryEnterTrendPullback(const double pullbackExtreme, const double atr)
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
   {
      Log("no se pudo leer el precio para la entrada en retroceso");
      return false;
   }

   if(TrendPullbackMarketEntry)
   {
      double swingLevel = (allowedDir > 0) ? pullbackExtreme : -pullbackExtreme;
      double mEntry = (allowedDir > 0) ? tick.ask : tick.bid;
      double mSpread = tick.ask - tick.bid;
      double mMinStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
      double structDist = MathAbs(mEntry - swingLevel) + SLBufferATR * atr;
      double mDist = MathMax(MathMax(structDist, MinSL_ATR * atr), mMinStop + mSpread);
      double mSL = (allowedDir > 0) ? mEntry - mDist : mEntry + mDist;
      if(!ApplyTenMinuteStop(allowedDir, mEntry,
                             MathMax(MinSL_ATR * atr, mMinStop + mSpread), mSL))
         return false;
      mDist = MathAbs(mEntry - mSL);
      if(mDist > MaxSL_ATR * atr)
      {
         Log("retroceso en tendencia: SL bajo el swing supera el maximo en ATR; entrada descartada");
         return false;
      }
      if(mSpread > MaxSpreadPctSL / 100.0 * mDist)
      {
         Log("retroceso en tendencia: spread vs SL alto");
         return false;
      }
      mEntry = NormalizeDouble(mEntry, _Digits);
      mSL = NormalizeDouble(mSL, _Digits);
      double mLots = CalcLots(allowedDir, mEntry, mSL);
      if(mLots <= 0) return false;
      string mCm = (allowedDir > 0) ? "Trend Pullback BUY MARKET" : "Trend Pullback SELL MARKET";
      bool mOk = OpenMarket(allowedDir, mLots, mEntry, mSL, mCm);
      PrintFormat("[SMC CB] Retroceso en tendencia %s MARKET lots=%.2f precio=%.5f SL=%.5f (%.2f ATR, bajo swing %.5f) -> %s (%d)",
                  allowedDir > 0 ? "BUY" : "SELL", mLots, mEntry, mSL, mDist / atr, swingLevel,
                  mOk ? "EJECUTADA" : "FALLO", gLastRetcode);
      return mOk;
   }

   double entry = (allowedDir > 0) ? pullbackExtreme : -pullbackExtreme;
   double slBuffer = MathMax(SLBufferATR, MinSL_ATR) * atr;
   double sl = (allowedDir > 0) ? entry - slBuffer : entry + slBuffer;
   double spread = tick.ask - tick.bid;
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(!ApplyTenMinuteStop(allowedDir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
      return false;
   double slDist = MathAbs(entry - sl);
   if(slDist > MaxSL_ATR * atr)
   {
      Log("entrada en retroceso descartada: SL supera el maximo en ATR");
      return false;
   }

   bool validLimit = (allowedDir > 0) ? entry < tick.bid - minStop
                                      : entry > tick.ask + minStop;
   if(!validLimit)
   {
      Log(allowedDir > 0 ? "zona baja de compra demasiado cerca o por encima del precio"
                         : "zona alta de venta demasiado cerca o por debajo del precio");
      return false;
   }
   if(slDist < minStop)
   {
      Log("entrada en retroceso descartada: SL menor al stop level del simbolo");
      return false;
   }

   double maxSpread = MaxSpreadPctSL / 100.0 * slDist;
   if(spread > maxSpread)
   {
      Log("entrada en retroceso bloqueada: spread vs SL alto");
      return false;
   }

   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);

   double lots = CalcLots(allowedDir, entry, sl);
   if(lots <= 0) return false;

   string comment = (allowedDir > 0) ? "Trend Pullback BUY LIMIT" : "Trend Pullback SELL LIMIT";
   bool ok = OpenLimit(allowedDir, lots, entry, sl, comment);
   PrintFormat("[SMC CB] Zona %s de retroceso %s LIMIT lots=%.2f precio=%.5f SL=%.5f TP=off (trailing ATR) expira en %d velas -> %s (%d)",
               allowedDir > 0 ? "BAJA" : "ALTA", allowedDir > 0 ? "BUY" : "SELL",
               lots, entry, sl, LimitOrderExpiryBars,
               ok ? "COLOCADA" : "FALLO", gLastRetcode);
   return ok;
}

void CheckTrendPullbackEntry(const bool allowEntry, const bool newBar)
{
   if(!EnableContinuationEntries || !EnableTrendPullbackEntries || !newBar) return;

   int n = MathMax(VisBars, TrendPullbackMaxBars + 2 * SwingStrength + 10);
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) return;

   double atr = GetATR(1);
   if(atr <= 0) return;

   double O[], H[], L[], C[];
   BuildSeries(r, n, allowedDir, O, H, L, C);

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, 64, hi, lo);
   int maxShift = TrendPullbackMaxBars + SwingStrength + 1;
   if(ArraySize(hi) < 2 || ArraySize(lo) < 2 ||
      hi[0] > maxShift || lo[0] > maxShift)
   {
      Log("esperando estructura reciente para entrada en retroceso");
      return;
   }

   double minStructureMove = 0.05 * atr;
   bool higherHigh = H[hi[0]] > H[hi[1]] + minStructureMove;
   bool higherLow = L[lo[0]] > L[lo[1]] + minStructureMove;
   if(!higherHigh || !higherLow)
   {
      Log("estructura reciente sin tendencia confirmada");
      return;
   }

   int peakShift = hi[0];
   if(peakShift <= SwingStrength)
   {
      Log("esperando confirmacion del swing antes de evaluar el retroceso");
      return;
   }

   double pullbackLow = DBL_MAX;
   for(int s = 1; s < peakShift; s++)
      pullbackLow = MathMin(pullbackLow, L[s]);

   double pullbackATR = (H[peakShift] - pullbackLow) / atr;
   if(pullbackATR < TrendPullbackMinATR || pullbackATR > TrendPullbackMaxATR)
   {
      Log("tendencia confirmada; esperando retroceso dentro del rango permitido");
      return;
   }

   bool rejection = C[1] > O[1] && C[1] > H[2] && C[1] < H[peakShift];
   if(!rejection)
   {
      Log("retroceso detectado; esperando rechazo a favor de la tendencia");
      return;
   }

   if(!EnableAutoTrading)
   {
      Log("rechazo del retroceso confirmado, pero el modo automatico esta desactivado");
      return;
   }
   if(!allowEntry)
   {
      Log("rechazo del retroceso confirmado, pero la entrada esta bloqueada por limites operativos");
      return;
   }

   PrintFormat("[SMC CB] Tendencia %s y retroceso de %.2f ATR rechazado; esperando retesteo de la zona extrema",
               allowedDir > 0 ? "alcista" : "bajista", pullbackATR);
   TryEnterTrendPullback(pullbackLow, atr);
}

void CheckContinuation(const bool allowEntry, const bool newBar)
{
   if(!EnableContinuationEntries)
   {
      continuationStatus = "entradas de continuacion desactivadas";
      return;
   }
   if(!EnableNPatternEntries)
   {
      continuationStatus = "patron N desactivado en Propiedades";
      return;
   }
   if(!newBar) return;

   int n = MathMax(VisBars, 120);
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n)
   {
      continuationStatus = "historial insuficiente para buscar patron N";
      return;
   }

   double atr = GetATR(1);
   if(atr <= 0)
   {
      continuationStatus = "ATR no disponible para buscar patron N";
      return;
   }
   continuationStatus = "sin ruptura N confirmada; esperando pullback y ruptura del swing intermedio";

   double H[], L[];
   ArrayResize(H, n);
   ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, 64, hi, lo);
   int maxNShift = SwingStrength + ContinuationMaxWaitBars + 1;
   double minStructureMove = 0.05 * atr;
   double minPullbackMove = 0.5 * atr;

   if(allowedDir < 0)
   {
      if(ArraySize(hi) < 2 || ArraySize(lo) < 1)
         continuationStatus = "esperando swings suficientes para patron N bajista";
      for(int h = 0; h + 1 < ArraySize(hi); h++)
      {
         int lowerHighShift = hi[h];
         int previousHighShift = hi[h+1];
         if(lowerHighShift <= SwingStrength || lowerHighShift > maxNShift) continue;
         if(H[lowerHighShift] >= H[previousHighShift] - minStructureMove) continue;

         for(int l = 0; l < ArraySize(lo); l++)
         {
            int middleLowShift = lo[l];
            if(middleLowShift <= lowerHighShift || middleLowShift >= previousHighShift) continue;
            if(H[lowerHighShift] - L[middleLowShift] < minPullbackMove) continue;

            bool brokeMiddleLow = r[1].close < L[middleLowShift] &&
                                  r[2].close >= L[middleLowShift];
            if(!brokeMiddleLow) continue;

            PrintFormat("[SMC CB] N bajista confirmada: maximo menor %.5f, swing intermedio %.5f roto; entrada %s",
                        H[lowerHighShift], L[middleLowShift],
                        MarketContinuationEntries ? "SELL al mercado" : "SELL LIMIT en el maximo menor");
            if(allowEntry && EnableAutoTrading)
            {
               bool opened = TryEnterContinuation(H[lowerHighShift], L[middleLowShift]);
               continuationStatus = opened ? "N bajista ejecutada o limite armado"
                                           : "N bajista detectada, pero bloqueada por filtros de SL, spread o riesgo";
            }
            else
            {
               continuationStatus = !EnableAutoTrading ? "N bajista detectada; trading automatico apagado"
                                                       : "N bajista detectada; bloqueada por limite operativo";
               Log("N bajista confirmada, pero entrada bloqueada por filtros o modo manual");
            }
            return;
         }
      }
   }
   else
   {
      if(ArraySize(hi) < 1 || ArraySize(lo) < 2)
         continuationStatus = "esperando swings suficientes para patron N alcista";
      for(int l = 0; l + 1 < ArraySize(lo); l++)
      {
         int higherLowShift = lo[l];
         int previousLowShift = lo[l+1];
         if(higherLowShift <= SwingStrength || higherLowShift > maxNShift) continue;
         if(L[higherLowShift] <= L[previousLowShift] + minStructureMove) continue;

         for(int h = 0; h < ArraySize(hi); h++)
         {
            int middleHighShift = hi[h];
            if(middleHighShift <= higherLowShift || middleHighShift >= previousLowShift) continue;
            if(H[middleHighShift] - L[higherLowShift] < minPullbackMove) continue;

            bool brokeMiddleHigh = r[1].close > H[middleHighShift] &&
                                   r[2].close <= H[middleHighShift];
            if(!brokeMiddleHigh) continue;

            PrintFormat("[SMC CB] N alcista confirmada: minimo mayor %.5f, swing intermedio %.5f roto; entrada %s",
                        L[higherLowShift], H[middleHighShift],
                        MarketContinuationEntries ? "BUY al mercado" : "BUY LIMIT en el minimo mayor");
            if(allowEntry && EnableAutoTrading)
            {
               bool opened = TryEnterContinuation(L[higherLowShift], H[middleHighShift]);
               continuationStatus = opened ? "N alcista ejecutada o limite armado"
                                           : "N alcista detectada, pero bloqueada por filtros de SL, spread o riesgo";
            }
            else
            {
               continuationStatus = !EnableAutoTrading ? "N alcista detectada; trading automatico apagado"
                                                       : "N alcista detectada; bloqueada por limite operativo";
               Log("N alcista confirmada, pero entrada bloqueada por filtros o modo manual");
            }
            return;
         }
      }
   }
}

void CheckCrashCompressionEntry(const bool allowEntry, const bool newBar)
{
   if(allowedDir >= 0 || !EnableCrashCompressionEntries)
   {
      crashCompressionStatus = "desactivada";
      return;
   }
   if(!newBar) return;

   int n = CrashCompressionLookbackBars + 2 * SwingStrength + 5;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n)
   {
      crashCompressionStatus = "esperando historial";
      return;
   }

   double atr = GetATR(1);
   if(atr <= 0)
   {
      crashCompressionStatus = "ATR no disponible";
      return;
   }

   double H[], L[];
   ArrayResize(H, n);
   ArrayResize(L, n);
   for(int s = 0; s < n; s++)
   {
      H[s] = r[s].high;
      L[s] = r[s].low;
   }

   int hi[], lo[];
   FindSwings(H, L, n, SwingStrength, 64, hi, lo);
   double support = 0;
   double lastLowerHigh = 0;
   bool compressionFound = false;
   double minLowerHigh = CrashCompressionMinLowerHighATR * atr;
   int peakCount = CrashCompressionMinLowerHighs + 1;

   for(int h = 0; h + peakCount <= ArraySize(hi); h++)
   {
      int oldestHigh = hi[h + peakCount - 1];
      if(oldestHigh > CrashCompressionLookbackBars) continue;

      double bounceSizes[];
      ArrayResize(bounceSizes, CrashCompressionMinLowerHighs);
      double lowestSupport = DBL_MAX;
      double highestSupport = -DBL_MAX;
      bool validCompression = true;

      for(int leg = 0; leg < CrashCompressionMinLowerHighs; leg++)
      {
         int newerHigh = hi[h + peakCount - 2 - leg];
         int olderHigh = hi[h + peakCount - 1 - leg];
         if(H[olderHigh] - H[newerHigh] < minLowerHigh)
         {
            validCompression = false;
            break;
         }

         double pullbackLow = DBL_MAX;
         for(int l = 0; l < ArraySize(lo); l++)
            if(lo[l] > newerHigh && lo[l] < olderHigh)
               pullbackLow = MathMin(pullbackLow, L[lo[l]]);
         if(pullbackLow == DBL_MAX)
         {
            validCompression = false;
            break;
         }

         double bounce = H[newerHigh] - pullbackLow;
         if(bounce < CrashCompressionMinBounceATR * atr ||
            (leg > 0 && bounce > bounceSizes[leg - 1] *
             (1.0 - CrashCompressionMinShrinkPct / 100.0)))
         {
            validCompression = false;
            break;
         }
         bounceSizes[leg] = bounce;
         lowestSupport = MathMin(lowestSupport, pullbackLow);
         highestSupport = MathMax(highestSupport, pullbackLow);
      }

      if(!validCompression ||
         highestSupport - lowestSupport > CrashCompressionSupportToleranceATR * atr)
         continue;

      support = lowestSupport;
      lastLowerHigh = H[hi[h]];
      compressionFound = true;
      break;
   }

   if(!compressionFound)
   {
      crashCompressionStatus = "sin compresion valida";
      return;
   }

   double breakLevel = support - CrashCompressionBreakBufferATR * atr;
   crashCompressionStatus = StringFormat("compresion; esperando cierre < %.5f", breakLevel);
   bool brokeSupport = r[1].close < breakLevel && r[2].close >= breakLevel;
   if(!brokeSupport) return;

   gCurDir = allowedDir;
   if(!EnableAutoTrading)
   {
      crashCompressionStatus = "ruptura confirmada; modo automatico apagado";
      Log("compresion Crash confirmada, pero el modo automatico esta desactivado");
      return;
   }
   if(!allowEntry)
   {
      crashCompressionStatus = "ruptura confirmada; bloqueada por limites operativos";
      Log("compresion Crash confirmada, pero la entrada esta bloqueada por limites operativos");
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
   {
      crashCompressionStatus = "ruptura confirmada; precio no disponible";
      Log("compresion Crash confirmada, pero no se pudo leer el precio");
      return;
   }

   double entry = tick.bid;
   double breakDistance = support - entry;
   if(entry >= breakLevel || breakDistance > CrashCompressionMaxBreakATR * atr)
   {
      crashCompressionStatus = "ruptura confirmada; precio ya extendido o recuperado";
      Log("ruptura de compresion Crash descartada: precio recuperado o demasiado alejado del soporte");
      return;
   }

   double spread = tick.ask - tick.bid;
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double sl = MathMax(lastLowerHigh + SLBufferATR * atr, entry + MinSL_ATR * atr);
   sl = MathMax(sl, tick.ask + minStop);
   if(!ApplyTenMinuteStop(allowedDir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
   {
      crashCompressionStatus = "no hay datos M1 suficientes para el SL";
      return;
   }
   double slDist = sl - entry;
   if(slDist > MaxSL_ATR * atr)
   {
      crashCompressionStatus = "ruptura confirmada; SL supera MaxSL_ATR";
      Log("entrada por compresion Crash descartada: SL supera el maximo en ATR");
      return;
   }

   double maxSpread = MaxSpreadPctSL / 100.0 * slDist;
   if(spread > maxSpread)
   {
      crashCompressionStatus = "ruptura confirmada; spread vs SL alto";
      Log("entrada por compresion Crash bloqueada: spread vs SL alto");
      return;
   }

   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);
   double lots = CalcLots(allowedDir, entry, sl);
   if(lots <= 0)
   {
      crashCompressionStatus = "ruptura confirmada; riesgo o lote no valido";
      return;
   }

   // El buffer y el maximo de extension controlan el chase para esta ruptura.
   bool ok = OpenMarket(allowedDir, lots, entry, sl,
                        "Crash Compression Break SELL", true);
   crashCompressionStatus = ok ? "VENTA ejecutada" : "ruptura confirmada; entrada rechazada por filtros";
   PrintFormat("[SMC CB] Compresion Crash: soporte %.5f roto, maximo menor %.5f, precio %.5f, SL %.5f (%.2f ATR), lote %.2f -> %s (%d)",
               support, lastLowerHigh, entry, sl, slDist / atr, lots,
               ok ? "EJECUTADA" : "NO EJECUTADA", gLastRetcode);
}

// Mantiene la zona visitada y espera un CHoCH local antes de operar.
void CheckZones(const bool allowEntry, const bool newBar)
{
   int sz = ArraySize(zones);
   if(sz == 0) return;

   MqlTick tick;
   bool hasTick = SymbolInfoTick(_Symbol, tick);

   for(int i = sz - 1; i >= 0; i--)
   {
      if(newBar)
      {
         zones[i].age++;
         if(zones[i].age > ZoneMaxAgeBars)
         {
            RemoveZone(i);
            continue;
         }

         int n = MathMax(VisBars, zones[i].age + 2 * SwingStrength + 10);
         MqlRates r[];
         ArraySetAsSeries(r, true);
         if(CopyRates(_Symbol, _Period, 0, n, r) != n) continue;

         double close = r[1].close;
         bool broken = (zones[i].dir > 0) ? close < zones[i].bottom : close > zones[i].top;
         if(broken)
         {
            Log("cierre invalido la zona de reaccion");
            RemoveZone(i);
            continue;
         }

         if(!zones[i].chochConfirmed)
         {
            double breakLevel = 0;
            if(DetectLocalChoch(r, n, zones[i].age + 1, breakLevel))
            {
               zones[i].chochConfirmed = true;
               zones[i].breakLevel = breakLevel;
               PrintFormat("[SMC CB] CHoCH %s confirmado en %.5f; esperando retest y rechazo",
                           zones[i].dir > 0 ? "ALCISTA" : "BAJISTA", breakLevel);
               DrawZone(zones[i]);
            }
         }
         else if(!zones[i].retestConfirmed)
         {
            double atr = GetATR(1);
            if(atr <= 0) continue;

            double tolerance = RetestToleranceATR * atr;
            bool rejected = (zones[i].dir > 0)
                            ? r[1].low <= zones[i].breakLevel + tolerance &&
                              r[1].close > zones[i].breakLevel &&
                              r[1].close > r[1].open
                            : r[1].high >= zones[i].breakLevel - tolerance &&
                              r[1].close < zones[i].breakLevel &&
                              r[1].close < r[1].open;
            bool failedBreak = (zones[i].dir > 0)
                               ? r[1].close < zones[i].breakLevel - tolerance
                               : r[1].close > zones[i].breakLevel + tolerance;
            if(failedBreak)
            {
               Log("el precio invalido el CHoCH antes del retest");
               RemoveZone(i);
               continue;
            }
            if(rejected)
            {
               zones[i].retestConfirmed = true;
               PrintFormat("[SMC CB] Retest y rechazo %s confirmados en %.5f",
                           zones[i].dir > 0 ? "alcista" : "bajista", zones[i].breakLevel);
               DrawZone(zones[i]);
               Alert(StringFormat("[SMC CB] Senal validada: %s %s. El EA intentara una entrada %s a mercado cerca de %.5f si los filtros lo permiten.",
                                  _Symbol, zones[i].dir > 0 ? "COMPRA" : "VENTA",
                                  zones[i].dir > 0 ? "BUY" : "SELL",
                                  zones[i].breakLevel));
            }
         }
      }

      bool reactionTouchEntry = !zones[i].trendSetup &&
                                zones[i].reactions >= MinZoneReactions &&
                                hasTick && tick.bid >= zones[i].bottom &&
                                tick.bid <= zones[i].top;
      if(reactionTouchEntry)
      {
         static datetime lastReactionTouchBar = 0;
         datetime touchBar = iTime(_Symbol, _Period, 0);
         if(touchBar != lastReactionTouchBar)
         {
            PrintFormat("[SMC CB] Precio toca zona con %d reacciones (%.5f-%.5f); preparando entrada %s",
                        zones[i].reactions, zones[i].bottom, zones[i].top,
                        zones[i].dir > 0 ? "BUY" : "SELL");
            lastReactionTouchBar = touchBar;
         }
      }

      bool entryConfirmed = reactionTouchEntry ||
                            zones[i].rejectionConfirmed ||
                            (zones[i].chochConfirmed && zones[i].retestConfirmed);
      if(!entryConfirmed) continue;
      if(!allowEntry)
      {
         static datetime lastBlockLog = 0;
         datetime bt = iTime(_Symbol, _Period, 0);
         if(bt != lastBlockLog)
         {
            PrintFormat("[SMC CB] Senal %s validada, pero no se envia orden. MOTIVO: %s",
                        zones[i].dir > 0 ? "BUY" : "SELL",
                        gWhy[zones[i].dir > 0 ? 0 : 1] == "" ? "limite operativo (ver panel)" : gWhy[zones[i].dir > 0 ? 0 : 1]);
            lastBlockLog = bt;
         }
         continue;
      }
      if(!hasTick)
      {
         Print("[SMC CB] Senal validada, pero no se envia orden: no se pudo obtener el precio actual.");
         continue;
      }
      if(!EnableAutoTrading)
      {
         Print("[SMC CB] Senal validada, pero no se envia orden: EnableAutoTrading esta desactivado.");
         continue;
      }

      gCurDir = zones[i].dir;
      if(reactionTouchEntry)
         gWhy[zones[i].dir > 0 ? 0 : 1] = "";
      if(TryEnter(zones[i], reactionTouchEntry)) { RemoveZone(i, true); break; }
   }
}

//================= TENDENCIA MAYOR (largo plazo) ==================//
// Idea: en una tendencia escalonada (maximos y minimos cada vez mas bajos en Crash,
// mas altos en Boom) cada impulso deja un FVG. El retorno a ese FVG, con
// rechazo, es la entrada con la tendencia. Se trabaja en serie espejada: aqui
// siempre "compra"; en Crash los precios van en negativo (BuildSeries).
struct LTZone
{
   double nearL;      // borde por donde el precio entra a la zona (precio real)
   double farL;       // borde lejano de la zona (precio real)
   string key;
   datetime t;
};
LTZone ltZ[];
int    ltConfirmIdx = -1;
string ltUsed[];
string ltStatus = "-";
string ltLastPrinted = "";

void LTSay(const string s)
{
   ltStatus = s;
   Log(s);
   if(s != ltLastPrinted) { ltLastPrinted = s; Print("[SMC CB] LT: ", s); }
}

double LTReal(const double m) { return (allowedDir > 0) ? m : -m; }

bool LTWasUsed(const string k)
{
   for(int i = 0; i < ArraySize(ltUsed); i++) if(ltUsed[i] == k) return true;
   return false;
}
void LTMarkUsed(const string k)
{
   int s = ArraySize(ltUsed);
   ArrayResize(ltUsed, s + 1);
   ltUsed[s] = k;
}

void LTRebuild()
{
   ArrayResize(ltZ, 0);
   ltConfirmIdx = -1;
   gCurDir = allowedDir;

   double atr = GetATR(1);
   if(atr <= 0) return;
   int n = LT_LookbackBars + 2 * LT_SwingStrength + 10;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) { LTSay("sin suficientes velas historicas"); return; }

   double O[], H[], L[], C[];
   BuildSeries(r, n, allowedDir, O, H, L, C);

   int hi[], lo[];
   FindSwings(H, L, n, LT_SwingStrength, 32, hi, lo);
   if(ArraySize(hi) < 3 || ArraySize(lo) < 3)
   {
      LTSay("pocas estructuras para evaluar la tendencia");
      return;
   }
   double m = 0.1 * atr;
   if(!(H[hi[0]] > H[hi[2]] + m && L[lo[0]] > L[lo[2]] + m))
   {
      LTSay("sin tendencia escalonada a favor (maximos/minimos no cumplen)");
      return;
   }

   double tolM = LT_NearToleranceATR * atr;
   int nImpulse = 0, nGap = 0, nBroken = 0, nTouched = 0, nUsed = 0;
   for(int s = 2; s <= LT_MaxZoneAgeBars && s + 2 < n; s++)
   {
      if(!(C[s] > O[s])) continue;
      if(C[s] - O[s] < LT_DisplacementATR * atr) continue;
      nImpulse++;
      if(!(L[s-1] > H[s+1])) continue;                 // FVG
      double gBot = H[s+1], gTop = L[s-1];
      if(gTop - gBot < LT_MinGapATR * atr) continue;
      nGap++;

      bool broken = false, touchedBefore = false;
      for(int k = s - 2; k >= 1; k--)
      {
         if(C[k] < gBot) { broken = true; break; }      // cierre mas alla del borde lejano: invalida
         if(k >= 2 && L[k] <= gTop) touchedBefore = true;
      }
      if(broken) { nBroken++; continue; }
      if(LT_FirstTouchOnly && touchedBefore) { nTouched++; continue; }

      string key = StringFormat("LT_%d_%I64d", allowedDir, (long)r[s].time);
      if(LTWasUsed(key)) { nUsed++; continue; }

      int idx = ArraySize(ltZ);
      ArrayResize(ltZ, idx + 1);
      ltZ[idx].nearL = LTReal(gTop);
      ltZ[idx].farL  = LTReal(gBot);
      ltZ[idx].key   = key;
      ltZ[idx].t     = r[s].time;

      // rechazo: la ultima vela cerrada llego a la zona (o a menos de la tolerancia) y cerro a favor
      if(ltConfirmIdx < 0 && L[1] <= gTop + tolM && C[1] > O[1])
      {
         bool wickOK = true;
         if(LT_MinWickPct > 0)
         {
            double rng = H[1] - L[1];
            wickOK = (rng > 0) && ((MathMin(O[1], C[1]) - L[1]) / rng * 100.0 >= LT_MinWickPct);
         }
         double depth = (gTop - C[1]) / (gTop - gBot) * 100.0;   // % recorrido dentro de la zona
         if(wickOK && depth <= LT_MaxPenetrationPct) ltConfirmIdx = idx;
      }
   }
   if(ArraySize(ltZ) == 0)
      LTSay(StringFormat("tendencia OK, pero sin FVG utilizable (impulsos=%d, con hueco=%d, rotos=%d, ya tocados=%d, ya usados=%d)",
                         nImpulse, nGap, nBroken, nTouched, nUsed));
   else if(ltConfirmIdx >= 0)
      LTSay(StringFormat("%d zona(s) vigente(s); rechazo confirmado en la ultima vela", ArraySize(ltZ)));
   else
      LTSay(StringFormat("%d zona(s) vigente(s); esperando que el precio llegue y rechace", ArraySize(ltZ)));
}

bool LTEnter(const int zi)
{
   double atr = GetATR(1);
   if(atr <= 0) return false;
   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) return false;

   double entry  = (allowedDir > 0) ? t.ask : t.bid;
   double spread = t.ask - t.bid;
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double buf = LT_SLBufferATR * atr;

   double dist = MathAbs(entry - ltZ[zi].farL) + buf;          // SL tras el borde lejano
   if(LT_SLMode == 1)
   {
      double ext = entry;                                      // SL tras el extremo reciente
      for(int s = 1; s <= LT_SLSwingBars; s++)
         ext = (allowedDir > 0) ? MathMin(ext, iLow(_Symbol, _Period, s))
                                : MathMax(ext, iHigh(_Symbol, _Period, s));
      dist = MathMin(dist, MathAbs(entry - ext) + buf);
   }
   dist = MathMax(dist, MathMax(MinSL_ATR * atr, minStop + spread));
   double sl = (allowedDir > 0) ? entry - dist : entry + dist;
   if(!ApplyTenMinuteStop(allowedDir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
   {
      LTSay("entrada descartada: faltan velas M1 para el SL de 10 minutos");
      return false;
   }
   dist = MathAbs(entry - sl);
   if(dist > LT_MaxSL_ATR * atr)
   {
      LTSay(StringFormat("entrada descartada: SL de %.1f ATR supera LT_MaxSL_ATR (%.1f)", dist / atr, LT_MaxSL_ATR));
      return false;
   }
   if(spread > MaxSpreadPctSL / 100.0 * dist)
   {
      LTSay("entrada descartada: spread alto frente al SL");
      return false;
   }
   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);
   double lots = CalcLots(allowedDir, entry, sl);
   if(lots <= 0) { LTSay("entrada descartada: lote invalido"); return false; }

   string cm = (allowedDir > 0) ? "LT Zona BUY" : "LT Zona SELL";
   bool ok = OpenMarket(allowedDir, lots, entry, sl, cm);
   PrintFormat("[SMC CB] Tendencia mayor %s lots=%.2f precio=%.5f SL=%.5f (%.1f ATR) zona %.5f-%.5f -> %s (%d)",
               allowedDir > 0 ? "BUY" : "SELL", lots, entry, sl, dist / atr,
               ltZ[zi].nearL, ltZ[zi].farL, ok ? "EJECUTADA" : "NO EJECUTADA", gLastRetcode);
   if(ok) { LTMarkUsed(ltZ[zi].key); LTSay("entrada ejecutada"); }
   else
   {
      string why = gWhy[allowedDir > 0 ? 0 : 1];
      LTSay("no se envio la orden: " + (why == "" ? "ver pestana Expertos" : why));
   }
   return ok;
}

void CheckLongTermEntry(const bool allowEntry, const bool newBar)
{
   if(!EnableLongTermEntries) return;
   if(newBar) LTRebuild();
   if(ArraySize(ltZ) == 0) return;
   if(!EnableAutoTrading) return;
   if(!allowEntry)
   {
      if(newBar)
      {
         string w = gWhy[allowedDir > 0 ? 0 : 1];
         LTSay("hay zona vigente pero hay limites operativos: " + (w == "" ? "ver panel" : w));
      }
      return;
   }
   gCurDir = allowedDir;

   if(LT_EntryTrigger == 1)
   {
      if(newBar && ltConfirmIdx >= 0) LTEnter(ltConfirmIdx);
      return;
   }

   // modo 0: al tocar la zona (tick). Un intento cada 3 s.
   static datetime lastTry = 0;
   if(TimeCurrent() - lastTry < 3) return;
   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) return;
   double atr = GetATR(1);
   if(atr <= 0) return;
   double tol = LT_NearToleranceATR * atr;
   for(int i = ArraySize(ltZ) - 1; i >= 0; i--)
   {
      bool broken = (allowedDir > 0) ? t.bid < ltZ[i].farL : t.ask > ltZ[i].farL;
      if(broken) { LTMarkUsed(ltZ[i].key); continue; }
      double nearAdj = ltZ[i].nearL + allowedDir * tol;
      bool touched = (allowedDir > 0) ? t.ask <= nearAdj : t.bid >= nearAdj;
      if(!touched) continue;
      double w = MathAbs(ltZ[i].farL - ltZ[i].nearL);
      double inside = (allowedDir > 0) ? ltZ[i].nearL - t.ask : t.bid - ltZ[i].nearL;
      if(w > 0 && inside / w * 100.0 > LT_MaxPenetrationPct) continue;
      lastTry = TimeCurrent();
      if(LTEnter(i)) break;
   }
}

//===================== GESTION DE POSICIONES ======================//
// Nivel de trailing estructural: ultimo swing confirmado a favor de la posicion.
bool StructureTrailLevel(const long type, const double atr, const double bid,
                         const double ask, double &level,
                         const int st = -1, const double bufATR = -1.0)
{
   const int n = 140;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, n, r) != n) return false;
   double H[], L[];
   ArrayResize(H, n); ArrayResize(L, n);
   for(int s = 0; s < n; s++) { H[s] = r[s].high; L[s] = r[s].low; }
   int stg = (st < 0) ? SwingStrength : st;
   int hi[], lo[];
   FindSwings(H, L, n, stg, 10, hi, lo);
   double buf = ((bufATR < 0) ? TrailSwingBufferATR : bufATR) * atr;
   if(type == POSITION_TYPE_BUY)
   {
      for(int i = 0; i < ArraySize(lo); i++)
         if(L[lo[i]] - buf < bid) { level = L[lo[i]] - buf; return true; }
   }
   else
   {
      for(int i = 0; i < ArraySize(hi); i++)
         if(H[hi[i]] + buf > ask) { level = H[hi[i]] + buf; return true; }
   }
   return false;
}

void ManagePositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      bool   isLT = (StringFind(PositionGetString(POSITION_COMMENT), "LT Zona") == 0);
      if(tp != 0.0 && !ModifySLTP(tk, sl, 0.0)) continue;   // nunca TP: solo trailing
      if(sl <= 0) continue;

      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double atr = GetATR(1);
      if(atr <= 0) continue;

      bool   isBuy = (type == POSITION_TYPE_BUY);
      double fav   = isBuy ? bid - open : open - ask;
      double desired = sl;
      bool   hasCandidate = false;

      if(isLT)
      {
         // Largo plazo: breakeven tardio, trailing por estructura y asegurar una fraccion de lo ganado
         if(LT_BreakEvenATR > 0 && fav >= LT_BreakEvenATR * atr)
         {
            double be = isBuy ? open + LT_BreakEvenLockATR * atr : open - LT_BreakEvenLockATR * atr;
            if(isBuy ? be > desired : be < desired) { desired = be; hasCandidate = true; }
         }
         if(LT_LockFraction > 0 && LT_LockStartATR > 0 && fav >= LT_LockStartATR * atr)
         {
            double lk = isBuy ? open + fav * LT_LockFraction : open - fav * LT_LockFraction;
            if(isBuy ? lk > desired : lk < desired) { desired = lk; hasCandidate = true; }
         }
         if(fav >= LT_TrailStartATR * atr)
         {
            double structSL;
            if(StructureTrailLevel(type, atr, bid, ask, structSL, LT_SwingStrength, LT_TrailSwingBufferATR))
            {
               double cap  = isBuy ? bid - LT_TrailMaxDistanceATR * atr : ask + LT_TrailMaxDistanceATR * atr;
               double cand = isBuy ? MathMax(structSL, cap) : MathMin(structSL, cap);
               if(isBuy ? cand > desired : cand < desired) { desired = cand; hasCandidate = true; }
            }
         }
      }
      else
      {
         // 1) Breakeven con pequena ganancia asegurada
         if(BreakEvenATR > 0 && fav >= BreakEvenATR * atr)
         {
            double be = isBuy ? open + BreakEvenLockATR * atr : open - BreakEvenLockATR * atr;
            if(isBuy ? be > desired : be < desired) { desired = be; hasCandidate = true; }
         }

         // 2) Trailing (ATR, estructura o hibrido)
         if(fav >= TrailStartATR * atr)
         {
            double dist = TrailDistanceATR * atr;
            bool   spikeLock = (SpikeTightenATR > 0 && fav >= SpikeTightenATR * atr);
            if(spikeLock) dist = SpikeTrailDistanceATR * atr;   // tras un spike se asegura rapido
            double cand = isBuy ? bid - dist : ask + dist;

            if(TrailMode >= 1 && !spikeLock)
            {
               double structSL;
               if(StructureTrailLevel(type, atr, bid, ask, structSL))
               {
                  if(TrailMode == 1) cand = structSL;
                  else
                  {
                     double cap = isBuy ? bid - TrailMaxDistanceATR * atr
                                        : ask + TrailMaxDistanceATR * atr;
                     cand = isBuy ? MathMax(structSL, cap) : MathMin(structSL, cap);
                  }
               }
            }
            if(isBuy ? cand > desired : cand < desired) { desired = cand; hasCandidate = true; }
         }
      }
      if(!hasCandidate) continue;

      double step = MathMax(TrailStepATR * atr, _Point);
      bool improved = isBuy ? desired - sl >= step : sl - desired >= step;
      if(!improved) continue;

      double minStop = (double)MathMax(SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL),
                                       SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL)) * _Point;
      if((isBuy && bid - desired < minStop) || (!isBuy && desired - ask < minStop))
         continue;

      if(!ModifySLTP(tk, NormalizeDouble(desired, _Digits), 0.0))
         PrintFormat("[SMC CB] No se pudo actualizar el trailing stop de la posicion %I64u.", tk);
   }
}

// Orden "limite" virtual: vigila el nivel y entra a mercado al tocarlo.
void CheckVirtualOrder()
{
   if(!gVirt.active) return;
   if(TimeCurrent() >= gVirt.expires)
   {
      gVirt.active = false;
      Print("[SMC CB] Nivel virtual expirado sin ser tocado.");
      return;
   }
   if(!EnableAutoTrading) return;

   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) return;
   double atr = GetATR(1);
   if(atr <= 0) return;

   bool dead = (gVirt.dir > 0) ? t.bid <= gVirt.sl : t.ask >= gVirt.sl;
   if(dead)
   {
      gVirt.active = false;
      Print("[SMC CB] Nivel virtual descartado: el precio ya perdio el SL planificado.");
      return;
   }

   double tol = VirtualTouchATR * atr;
   bool touched = (gVirt.dir > 0) ? t.ask <= gVirt.level + tol : t.bid >= gVirt.level - tol;
   if(!touched) return;

   gCurDir = allowedDir;
   VirtualOrder v = gVirt;
   gVirt.active = false;                 // libera el cupo para que CanTradeNow no lo cuente
   if(!CanTradeNow(true))
   {
      gVirt = v;                         // sigue vigente hasta expirar
      return;
   }

   double spread = t.ask - t.bid;
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double entry = (v.dir > 0) ? t.ask : t.bid;
   double dist = MathMax(MathAbs(entry - v.sl), minStop + spread);
   double sl = (v.dir > 0) ? entry - dist : entry + dist;
   if(!ApplyTenMinuteStop(v.dir, entry,
                          MathMax(MinSL_ATR * atr, minStop + spread), sl))
   {
      gVirt = v;
      return;
   }
   dist = MathAbs(entry - sl);
   if(dist > MaxSL_ATR * atr * 1.5)
   {
      Print("[SMC CB] Nivel virtual descartado: SL M1 de 10 minutos demasiado amplio.");
      return;
   }
   if(spread > MaxSpreadPctSL / 100.0 * dist)
   {
      gVirt = v;
      return;
   }
   entry = NormalizeDouble(entry, _Digits);
   sl = NormalizeDouble(sl, _Digits);
   double lots = CalcLots(v.dir, entry, sl);
   if(lots <= 0) return;

   bool ok = OpenMarket(v.dir, lots, entry, sl, v.cm);
   PrintFormat("[SMC CB] Nivel virtual %s tocado %.5f: MARKET %.5f SL %.5f (%.2f ATR) -> %s (%d)",
               v.dir > 0 ? "BUY" : "SELL", v.level, entry, sl, dist / atr,
               ok ? "EJECUTADA" : "FALLO", gLastRetcode);
   if(!ok) gVirt = v;
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
   if(dir != allowedDir) return;

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
   if(mitig && !broken)
   {
      double top = (dir > 0) ? zTop : -zBot;
      double bot = (dir > 0) ? zBot : -zTop;
      RegisterTouchedOB(dir, top, bot, r[ob].time);
   }
   if(!ShowOB) return;
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
   if(!(ShowStructure || ShowOB || ShowFVG || ShowSwings || ShowPD ||
        EnableAnticipatedLineEntries)) return true;

   int st = SwingStrength;
   int n  = VisBars + 2 * st + 10;
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
   ArrayResize(touchedOBZones, 0);

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
   if(ShowStructure || ShowOB || EnableAnticipatedLineEntries)
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
      bias = (biasDir > 0) ? "ALCISTA" : ((biasDir < 0) ? "BAJISTA" : "NEUTRAL");

   double closed; int entries;
   DayStats(closed, entries);

   string s = "EA Wey Spike + Zona + CHoCH + Retest " + indexType + " v2.17\n";
   s += "Modo: " + (EnableAutoTrading ? "AUTOMATICO" : "MANUAL (solo marca/avisa)") + "\n";
   s += "Direccion: " + (allowedDir > 0 ? "SOLO COMPRAS (Boom)" : "SOLO VENTAS (Crash)") + "  Lote maximo: " + DoubleToString(FixedLotSize, 3) + "\n";
   s += "SL: extremo ultimas 10 velas M1 + margen ATR; riesgo maximo " +
        DoubleToString(MaxLossPerTradeUSD, 2) + " " + AccountInfoString(ACCOUNT_CURRENCY) + "\n";
   s += "Spike: " + (EnableSpikeImpulseEntries
                      ? "MERCADO al " + DoubleToString(SpikeRetracementPct, 0) +
                        "% del spike (>= " + DoubleToString(SpikeEntryATR, 1) + " ATR), espera " +
                        IntegerToString(SpikeWaitBars()) + " velas, tendencia grafico " +
                        (SpikeRequireTrend ? "ON" : "OFF") +
                        (spikeRetracementPending ? "  | PENDIENTE nivel " + DoubleToString(pendingSpikeEntry, _Digits) : "")
                      : "entrada por spike desactivada") + "\n";
   s += "Zonas: entrada MARKET al primer toque de reaccion; CHoCH/retest para otras zonas\n";
   s += "Ordenes limite: " + (UseVirtualLimits ? "VIRTUALES (entrada a mercado al tocar)" : "del broker") +
        "  Trailing: " + (TrailMode == 0 ? "ATR" : (TrailMode == 1 ? "estructura" : "hibrido")) +
        "  Sin TP\n";
   if(UseVirtualLimits)
   {
      if(gVirt.active)
      {
         double touchTolerance = VirtualTouchATR * GetATR(1);
         s += "Pendiente virtual (no broker): " +
              (gVirt.dir > 0 ? "BUY LIMIT" : "SELL LIMIT") +
              " en " + DoubleToString(gVirt.level, _Digits) +
              "; espera retorno al nivel (tol. " +
              DoubleToString(touchTolerance, _Digits) +
              "), vence " + TimeToString(gVirt.expires, TIME_MINUTES) + "\n";
      }
      else
         s += "Pendiente virtual: ninguna\n";
   }
   s += "Filtro zona en contra: " + (BlockEntriesIntoOpposingZone
                                      ? "ON (" + IntegerToString(ArraySize(gOppLevels)) + " niveles vigentes)" : "OFF") + "\n";
   s += "Tendencia mayor (largo plazo): " + (EnableLongTermEntries
        ? "ON, " + (LT_EntryTrigger == 1 ? "al rechazo" : "al tocar") + ", " + IntegerToString(ArraySize(ltZ)) + " zona(s)" : "OFF") + "\n   LT estado: " + ltStatus + "\n";
   s += "Patron N: " + (EnableContinuationEntries && EnableNPatternEntries
                         ? (MarketContinuationEntries ? "ON, MARKET al confirmar ruptura"
                                                      : "ON, LIMIT en retesteo tras ruptura")
                         : "OFF") + " | " + continuationStatus + "\n";
   if(allowedDir < 0)
      s += "Compresion Crash: " + crashCompressionStatus + "\n";
   s += "Entrada anticipada: " + (EnableAnticipatedLineEntries
                                   ? "ETA <= 120 s antes de linea; OB al toque"
                                   : "desactivada") + "\n";
   s += "Posiciones extra por toque OB: " +
        (AllowAdditionalOBTouchPositions ? "SI (sujetas al limite diario)" : "NO") + "\n";
   s += "Sesgo " + EnumToString(HTF_Bias) + " (informativo): " + bias + " [" + biasSource + "]\n";
   s += "Sesion: " + (InSession() ? "ACTIVA" : "FUERA") + "  (hora servidor " + TimeToString(TimeCurrent(), TIME_MINUTES) + ")\n";
   s += "Spread: " + IntegerToString((int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD)) + " pts (max " + DoubleToString(MaxSpreadPctSL, 1) + "% del SL)\n";
   s += "Zonas activas: " + IntegerToString(ArraySize(zones));
   s += "  OB tocados: " + IntegerToString(ArraySize(touchedOBZones));
   if(ArraySize(zones) > 0)
   {
      s += "  " + (zones[0].trendSetup ? "tendencia local" :
                    "reacciones=" + IntegerToString(zones[0].reactions)) + "  ";
      if(!zones[0].trendSetup && zones[0].reactions >= MinZoneReactions)
         s += "entrada al primer toque";
      else
         s += zones[0].rejectionConfirmed ? "rechazo confirmado" :
              (!zones[0].chochConfirmed ? "CHoCH esperando" :
              (zones[0].retestConfirmed ? "retest validado" : "esperando retest"));
   }
   if(gWhy[allowedDir > 0 ? 0 : 1] != "")
      s += "\nAnalisis: " + gWhy[allowedDir > 0 ? 0 : 1];
   s += "\n";
   s += "Operaciones hoy: " + IntegerToString(entries) + "/";
   s += "sin limite";
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   s += "   PnL dia (cerrado+flotante): " + DoubleToString(closed + OurFloating(), 2) + " " + currency + "\n";
   s += "Limite perdida: " + (DailyLossLimitUSD > 0 ? DoubleToString(DailyLossLimitUSD, 2) + " " + currency : "OFF");
   s += "   Objetivo ganancia: " + (DailyProfitTargetUSD > 0 ? DoubleToString(DailyProfitTargetUSD, 2) + " " + currency : "OFF");
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
   CheckVirtualOrder();
   if(!visReady) visReady = UpdateVisuals();

   bool newBar = IsNewBar();
   if(newBar) { gWhy[0] = ""; gWhy[1] = ""; }

   bool allow = CanTradeNow();
   CheckSpikeImpulseEntry();
   if(ArraySize(zones) > 0)
      CheckZones(CanTradeNow(), newBar);
   if(newBar) ScanForZones();
   if(EnableAnticipatedLineEntries)
      CheckAnticipatedLineEntry(CanTradeNow());
   CheckLongTermEntry(allow, newBar);
   if(!newBar) return;

   CheckCrashCompressionEntry(allow, true);
   CheckContinuation(CanTradeNow(), true);
   CheckTrendPullbackEntry(CanTradeNow(), true);
   if(LogEachBar)
      PrintFormat("[SMC CB] Nueva vela %s %s | servidor %s | sesion=%s | spread=%d | sesgo=%d | zonas=%d | operar=%s | señal %s: %s",
                  _Symbol, EnumToString(_Period), TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES),
                  InSession() ? "SI" : "NO",
                  (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), biasDir, ArraySize(zones), allow ? "SI" : "NO",
                  allowedDir > 0 ? "COMPRA" : "VENTA",
                  gWhy[allowedDir > 0 ? 0 : 1] == "" ? "-" : gWhy[allowedDir > 0 ? 0 : 1]);
   UpdateVisuals();     // redibujar estructura, OB y FVG
   UpdatePanel();
}
