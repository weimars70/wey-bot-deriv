//+------------------------------------------------------------------+
//|                                           DerivApp_Bridge_EA.mq5 |
//|                     Copyright 2026, Deriv App Trading Bridge.     |
//|                                      http://localhost:9000/bot/  |
//+------------------------------------------------------------------+
#property copyright "Deriv App Trading Bridge"
#property link      "http://localhost:9000/bot/"
#property version   "1.14"
#property description "Puente de comunicacion automatica entre Deriv App Web y MetaTrader 5."
#property description "Gestiona ordenes de: Estrategia H1 (sin SL, cierre por spike +5min / timeout 10min),"
#property description "Estrategia Doble Vela sin Mecha y Estrategia Zonas V (CRASH_BOOM_IA)."

#include <Trade\Trade.mqh>

//--- Entradas configurables
input group "=== Configuracion del Puente Deriv App ==="
input double   DefaultLotSize          = 1.00;           // Lotaje por defecto si no viene especificado
input ulong    BridgeMagicNumber       = 999888;         // Magic Number de las operaciones del puente
input bool     ProtectAllPositions     = false;          // Si es true, permite gestionar operaciones manuales. Dejar en FALSE para NUNCA tocar trades manuales.
input double   ProfitProtectionPercent = 70.0;           // Porcentaje a PROTEGER del pico maximo (ej: 70 = asegura el 70% de la ganancia)
input double   MinProfitThresholdUSD   = 8.00;           // Ganancia minima acumulada en USD para activar la proteccion de trailing (8.00 USD)
input int      PollIntervalMs          = 400;            // Frecuencia de sincronizacion (milisegundos)
input int      SlippagePoints          = 20;             // Desviacion maxima permitida (puntos)
input int      M5XHistoryCandles       = 9000;           // Historial M5 exportado por indice (~31 dias)
input group "=== Limites de Concurrencia por Grupo ==="
input int      MaxCrashBoomTrades      = 3;              // Maximo concurrentes en Crash y Boom (3)
input int      MaxXauusdTrades         = 1;              // Maximo concurrentes en XAUUSD (1)
input int      MaxOtherTrades          = 2;              // Maximo concurrentes en los demas indices y forex (2)
input int      NoSpikeTimeoutM1Bars    = 8;              // SL maximo en Crash/Boom: 8 minutos (8 velas M1)

input group "=== Configuracion de Stop Loss Monetario ==="
input double   MaxLossDefaultUSD       = 5.00;           // Stop Loss monetario por defecto en USD para Crash/Boom (5.00 USD)
input double   MaxLossCrash600USD      = 8.00;           // Stop Loss monetario para Crash 600 en USD (8.00 USD)
input double   MaxLossSyntheticsUSD    = 7.00;           // Stop Loss monetario para Step, Jump y Volatility (7.00 USD)
input double   MaxLossForexUSD         = 8.00;           // Stop Loss monetario para Forex y Metales (8.00 USD)

//--- Objeto de trading nativo
CTrade trade;

//--- Variables de estado
string commandsFileName = "deriv_bridge_commands.json";
string feedbackFileName = "deriv_bridge_feedback.json";
string executedCommands[];
int gvCleanupCounter = 0;
int m5XExportCounter = 0;

//+------------------------------------------------------------------+
//| Clasificar categoria del simbolo:                                |
//| 0 = CRASH_BOOM                                                   |
//| 1 = SYNTHETIC_OTHER (Step, Jump, Volatility)                     |
//| 2 = FOREX_METALS (XAUUSD, XAGUSD, pares Forex)                   |
//+------------------------------------------------------------------+
int GetSymbolCategory(string sym)
{
   string up = sym;
   StringToUpper(up);
   if(StringFind(up, "CRASH") >= 0 || StringFind(up, "BOOM") >= 0)
      return 0;
   if(StringFind(up, "XAU") >= 0 || StringFind(up, "XAG") >= 0 ||
      StringFind(up, "GOLD") >= 0 || StringFind(up, "SILVER") >= 0 ||
      StringFind(up, "EURUSD") >= 0 || StringFind(up, "GBPUSD") >= 0 ||
      StringFind(up, "GBPJPY") >= 0 || StringFind(up, "USDJPY") >= 0 ||
      StringFind(up, "FRX") >= 0)
      return 2;
   return 1;
}

//+------------------------------------------------------------------+
//| Obtener Stop Loss maximo en USD segun el simbolo                 |
//+------------------------------------------------------------------+
double GetMaxLossForSymbolUSD(string sym)
{
   int cat = GetSymbolCategory(sym);
   if(cat == 2) return MaxLossForexUSD;      // 8 USD para Forex/Metales
   if(cat == 1) return MaxLossSyntheticsUSD; // 7 USD para Step, Jump, Volatility

   string up = sym;
   StringToUpper(up);
   if(StringFind(up, "600") >= 0 && StringFind(up, "CRASH") >= 0)
      return MaxLossCrash600USD;
   if(StringFind(up, "300") >= 0 && StringFind(up, "CRASH") >= 0)
      return 10.00; // 19 minutos a 0.50 lotes (~19-20 pts)
   return MaxLossDefaultUSD;
}

//+------------------------------------------------------------------+
//| Minimum favorable M1 movement considered a spike for each index  |
//+------------------------------------------------------------------+
double GetM1SpikeThreshold(string sym)
{
   string up = sym;
   StringToUpper(up);
   if(StringFind(up, "1000") >= 0) return 10.0;
   if(StringFind(up, "100") >= 0)  return 30.0;
   if(StringFind(up, "200") >= 0)  return 35.0;
   if(StringFind(up, "300") >= 0)  return 25.0;
   if(StringFind(up, "500") >= 0)  return 20.0;
   if(StringFind(up, "600") >= 0)  return 15.0;
   if(StringFind(up, "900") >= 0)  return 12.0;
   return 10.0;
}

//+------------------------------------------------------------------+
//| Looks for a spike in the trade direction from its opening time   |
//+------------------------------------------------------------------+
bool HasFavorableM1SpikeSince(string sym, datetime entryTime, bool isBuy)
{
   MqlRates rates[];
   int copied = CopyRates(sym, PERIOD_M1, entryTime, TimeCurrent(), rates);
   if(copied <= 0) return false;

   double threshold = GetM1SpikeThreshold(sym);
   for(int i = 0; i < copied; i++)
   {
      double favorableMove = isBuy ? rates[i].high - rates[i].open
                                    : rates[i].open - rates[i].low;
      if(favorableMove >= threshold) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Local safety: 8 M1 bars (8 min) without profit on Crash/Boom     |
//+------------------------------------------------------------------+
void ManageNoSpikeTimeout()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;

      ulong posMagic = PositionGetInteger(POSITION_MAGIC);
      if(posMagic != BridgeMagicNumber && !ProtectAllPositions) continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      // El SL por tiempo de 8 minutos aplica exclusivamente a Crash y Boom
      if(GetSymbolCategory(sym) != 0) continue;

      datetime entryTime = (datetime)PositionGetInteger(POSITION_TIME);
      bool isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double curProfit = PositionGetDouble(POSITION_PROFIT);
      string spikeGV = "DAPP_SPIKE_" + (string)ticket;
      string covGV   = "DAPP_COV_" + (string)ticket;

      bool hadSpike = GlobalVariableCheck(spikeGV);
      if(!hadSpike && (HasFavorableM1SpikeSince(sym, entryTime, isBuy) || curProfit >= 3.00))
      {
         hadSpike = true;
         GlobalVariableSet(spikeGV, 1.0);
         Print("[DerivApp Bridge] Spike/Profit detectado para Crash/Boom ticket #", ticket, " (", sym, ").");
      }

      // Si el trade está en ganancia positiva, limpiar contador de spike cubierto
      if(curProfit > 0.0)
      {
         if(GlobalVariableCheck(covGV)) GlobalVariableDel(covGV);
         continue;
      }

      // ── REGLA USUARIO: Si tuvo spike y en el retroceso cubre el spike (curProfit <= 0),
      // esperar 3 minutos (180s). Si no hay nuevo spike, salir inmediatamente (sin esperar al 60%).
      if(hadSpike)
      {
         datetime covTime = 0;
         if(!GlobalVariableCheck(covGV))
         {
            covTime = TimeCurrent();
            GlobalVariableSet(covGV, (double)covTime);
            Print("⚠️ [DerivApp Bridge] Ticket #", ticket, " (", sym, ") tuvo spike y el retroceso lo cubrió (Profit: $", DoubleToString(curProfit, 2), "). Esperando 3 min (180s) por nuevo spike antes de salir.");
         }
         else
         {
            covTime = (datetime)GlobalVariableGet(covGV);
         }

         int secSinceCovered = (int)(TimeCurrent() - covTime);
         if(secSinceCovered >= 180) // 3 minutos
         {
            Print("⏱️ [DerivApp Bridge] Cerrando ticket #", ticket, " tras 3 minutos con spike cubierto sin nuevo spike.");
            if(trade.PositionClose(ticket))
            {
               WriteFeedback("timeout_3min_spike_covered", "", "CLOSED", ticket, "Closed after 3 min spike covered without new spike");
               GlobalVariableDel("DAPP_MAXP_" + (string)ticket);
               GlobalVariableDel(spikeGV);
               GlobalVariableDel(covGV);
               GlobalVariableDel("DAPP_TSL_" + (string)ticket);
               GlobalVariableSet("DAPP_SL_" + sym, (double)TimeCurrent());
            }
            continue;
         }
         continue; // Mientras está en los 3 minutos de gracia por spike cubierto, no cae al SL regular
      }

      // ── ELIMINADO EL CIERRE PREMATURO A LOS 8 MINUTOS ──
      // Para respetar la instrucción del usuario y el Stop Loss total (técnico y monetario -5 USD),
      // la posición no se cierra prematuramente a los 8 minutos con pérdidas pequeñas.
   }
}

//+------------------------------------------------------------------+
//| Control de Stop Loss Técnico Virtual (Order Block SL)             |
//+------------------------------------------------------------------+
void CheckTechnicalStopLoss()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      
      ulong posMagic = PositionGetInteger(POSITION_MAGIC);
      if(posMagic != BridgeMagicNumber && !ProtectAllPositions) continue;
      
      string tslGV = "DAPP_TSL_" + (string)ticket;
      if(!GlobalVariableCheck(tslGV)) continue;
      
      double slPrice = GlobalVariableGet(tslGV);
      if(slPrice <= 0.0) continue;
      
      string sym = PositionGetString(POSITION_SYMBOL);
      bool isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double curPrice = isBuy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
      if(curPrice <= 0.0) continue;
      
      bool slHit = isBuy ? (curPrice <= slPrice) : (curPrice >= slPrice);
      if(slHit)
      {
         Print("🛑 [DerivApp Bridge] SL TÉCNICO alcanzado en ", sym, " (Ticket #", ticket, "): Precio actual ", DoubleToString(curPrice, 3), " cruzó SL de Order Block ", DoubleToString(slPrice, 3), ". Cerrando operación.");
         if(trade.PositionClose(ticket))
         {
            WriteFeedback("sl_technical", "", "CLOSED", ticket, "Closed by Technical Order Block Stop Loss");
            GlobalVariableDel(tslGV);
            GlobalVariableDel("DAPP_MAXP_" + (string)ticket);
            GlobalVariableDel("DAPP_SPIKE_" + (string)ticket);
            GlobalVariableDel("DAPP_COV_" + (string)ticket);
            GlobalVariableSet("DAPP_SL_" + sym, (double)TimeCurrent());
            Print("⏳ [DerivApp Bridge] Cooldown de 30 minutos activado para ", sym, " tras salida en Stop Loss técnico.");
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Control estricto de Stop Loss en USD: cierra la orden si la       |
//| perdida flotante alcanza el limite (-5 USD o -8 USD en Crash 600)|
//+------------------------------------------------------------------+
void CheckMonetaryStopLoss()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      
      ulong posMagic = PositionGetInteger(POSITION_MAGIC);
      if(posMagic != BridgeMagicNumber && !ProtectAllPositions) continue;
      
      string posSym = PositionGetString(POSITION_SYMBOL);
      double curProfit = PositionGetDouble(POSITION_PROFIT);
      double maxLoss = GetMaxLossForSymbolUSD(posSym);
      
      if(curProfit <= -maxLoss)
      {
         Print("🛑 [DerivApp Bridge] Stop Loss monetario alcanzado en ", posSym, " (Ticket #", ticket, "): Pérdida ", DoubleToString(curProfit, 2), " USD (límite -", DoubleToString(maxLoss, 2), " USD). Cerrando operacion inmediatamente.");
         if(trade.PositionClose(ticket))
         {
            WriteFeedback("sl_monetary", "", "CLOSED", ticket, "Closed by MaxLossUSD Stop Loss");
            GlobalVariableSet("DAPP_SL_" + posSym, (double)TimeCurrent());
            Print("⏳ [DerivApp Bridge] Cooldown de 30 minutos activado para ", posSym, " tras salida en Stop Loss monetario.");
            if(GetSymbolBucket(posSym) == 1)
            {
               GlobalVariableSet("DAPP_GOLD_SL_TIME", (double)TimeCurrent());
               Print("⏳ [DerivApp Bridge] Cooldown de 10 minutos activado para XAUUSD tras salida en Stop Loss monetario.");
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Trailing Stop por categoria (sin marcar SL ni TP en MT5):        |
//| - Crash/Boom (cat 0): 60% siempre que este en profit             |
//| - Step/Jump/Volatility (cat 1): 50% siempre que este en profit   |
//| - Forex/Metales (cat 2): 60% cuando profit > 8 USD               |
//+------------------------------------------------------------------+
void ProtectProfitTarget()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      
      // REGLA CRITICA: SOLO gestionar operaciones puestas por el bot (BridgeMagicNumber).
      ulong posMagic = PositionGetInteger(POSITION_MAGIC);
      if(!ProtectAllPositions && posMagic != BridgeMagicNumber)
      {
         continue;
      }
      
      string posSym = PositionGetString(POSITION_SYMBOL);
      int cat = GetSymbolCategory(posSym);
      double profit = PositionGetDouble(POSITION_PROFIT);
      string gvName = "DAPP_MAXP_" + (string)ticket;
      
      double maxProf = 0.0;
      if(GlobalVariableCheck(gvName))
      {
         maxProf = GlobalVariableGet(gvName);
      }
      
      // Si el profit actual supera el maximo previo, actualizar el pico permanente
      if(profit > maxProf)
      {
         maxProf = profit;
         GlobalVariableSet(gvName, maxProf);
      }
      
      bool shouldCheckTrailing = false;
      double ratio = 0.60;
      if(cat == 0)
      {
         // Crash y Boom: Trailing Stop Inteligente Escalonado (NUNCA dejar devolver ganancias grandes)
         if(maxProf >= 30.00)
         {
            shouldCheckTrailing = true;
            ratio = 0.70; // Asegura el 70% del pico (ej: en $30 asegura $21; en $70 asegura $49 USD)
         }
         else if(maxProf >= 15.00)
         {
            shouldCheckTrailing = true;
            ratio = 0.60; // Asegura el 60% del pico (ej: en $15 asegura $9; en $20 asegura $12 USD)
         }
         else if(maxProf >= 8.00)
         {
            shouldCheckTrailing = true;
            ratio = 0.50; // Asegura el 50% del pico (ej: en $8 asegura $4; en $10 asegura $5 USD)
         }
      }
      else if(cat == 1)
      {
         // Step, Jump, Volatility: asegurar el 50% solo si el profit superó los 8 USD
         if(maxProf > 8.00)
         {
            shouldCheckTrailing = true;
            ratio = 0.50;
         }
      }
      else if(cat == 2)
      {
         // Forex y Metales: asegurar el 60% solo cuando profit > 8 USD
         if(maxProf > 8.00)
         {
            shouldCheckTrailing = true;
            ratio = 0.60;
         }
      }
      
      if(shouldCheckTrailing)
      {
         double floorProfit = NormalizeDouble(maxProf * ratio, 2);
         if(cat == 0 && floorProfit < 4.00) floorProfit = 4.00; // Minimo  USD asegurados en Crash/Boom
         if(profit <= floorProfit)
         {
            Print("🛡️ [DerivApp Bridge] ¡TRAILING STOP ", DoubleToString(ratio * 100.0, 0), "% ACTIVADO! ", posSym,
                  " Ticket #", ticket,
                  " | Pico máx: +$", DoubleToString(maxProf, 2),
                  " -> Actual: +$", DoubleToString(profit, 2),
                  " | Piso asegurado: +$", DoubleToString(floorProfit, 2));
                  
            if(trade.PositionClose(ticket))
            {
               Print("✅ [DerivApp Bridge] Posicion #", ticket, " cerrada asegurando el ", DoubleToString(ratio * 100.0, 0), "% del profit.");
               GlobalVariableDel(gvName);
            }
            else
            {
               Print("❌ [DerivApp Bridge] Error cerrando posicion #", ticket, " RetCode: ", trade.ResultRetcode());
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Limpieza de variables globales de posiciones que ya no existen   |
//+------------------------------------------------------------------+
void CleanupOrphanedGlobalVariables()
{
   int totalGVs = GlobalVariablesTotal();
   for(int g = totalGVs - 1; g >= 0; g--)
   {
      string gvName = GlobalVariableName(g);
       if(StringFind(gvName, "DAPP_MAXP_") == 0 || StringFind(gvName, "DAPP_SPIKE_") == 0 || StringFind(gvName, "DAPP_TSL_") == 0 || StringFind(gvName, "DAPP_COV_") == 0)
       {
          int prefixLen = StringFind(gvName, "DAPP_MAXP_") == 0 ? 10 : 11;
          string ticketStr = StringSubstr(gvName, prefixLen);
         ulong ticket = (ulong)StringToInteger(ticketStr);
         if(!PositionSelectByTicket(ticket))
         {
            GlobalVariableDel(gvName);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   ManageNoSpikeTimeout();
   CheckTechnicalStopLoss();
   // Evaluar protección 70% de inmediato en cada tick entrante
   ProtectProfitTarget();
}

//+------------------------------------------------------------------+
//| Buscar un simbolo en la lista del broker si tiene sufijo/variante|
//+------------------------------------------------------------------+
string FindBrokerSymbolMatch(string target, string altTarget = "")
{
   if(SymbolSelect(target, true) && SymbolInfoDouble(target, SYMBOL_BID) > 0)
      return target;
   if(altTarget != "" && SymbolSelect(altTarget, true) && SymbolInfoDouble(altTarget, SYMBOL_BID) > 0)
      return altTarget;

   string tUp = target;
   StringToUpper(tUp);
   string aUp = altTarget;
   StringToUpper(aUp);

   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      string nUp = name;
      StringToUpper(nUp);
      if(StringFind(nUp, tUp) >= 0 || (aUp != "" && StringFind(nUp, aUp) >= 0))
      {
         SymbolSelect(name, true);
         return name;
      }
   }
   return target;
}

//+------------------------------------------------------------------+
//| Mapeo inteligente de simbolos entre Deriv Web API y Deriv MT5   |
//+------------------------------------------------------------------+
string NormalizeSymbol(string webSymbol)
{
   string s = webSymbol;
   StringToUpper(s);
   
   // 1. IMPORTANTE: Evaluar primero índices de 4 dígitos para que 'CRASH1000' no coincida con 'CRASH100'
   if(StringFind(s, "CRASH1000") >= 0 || StringFind(s, "CRASH 1000") >= 0) return "Crash 1000 Index";
   if(StringFind(s, "BOOM1000") >= 0 || StringFind(s, "BOOM 1000") >= 0) return "Boom 1000 Index";
   
   // 2. Índices de 3 dígitos Crash & Boom
   if(StringFind(s, "CRASH100") >= 0 || StringFind(s, "CRASH 100") >= 0) return "Crash 100 Index";
   if(StringFind(s, "CRASH200") >= 0 || StringFind(s, "CRASH 200") >= 0) return "Crash 200 Index";
   if(StringFind(s, "CRASH300") >= 0 || StringFind(s, "CRASH 300") >= 0) return "Crash 300 Index";
   if(StringFind(s, "CRASH500") >= 0 || StringFind(s, "CRASH 500") >= 0) return "Crash 500 Index";
   if(StringFind(s, "CRASH600") >= 0 || StringFind(s, "CRASH 600") >= 0) return "Crash 600 Index";
   if(StringFind(s, "CRASH900") >= 0 || StringFind(s, "CRASH 900") >= 0) return "Crash 900 Index";
   
   if(StringFind(s, "BOOM100") >= 0 || StringFind(s, "BOOM 100") >= 0) return "Boom 100 Index";
   if(StringFind(s, "BOOM200") >= 0 || StringFind(s, "BOOM 200") >= 0) return "Boom 200 Index";
   if(StringFind(s, "BOOM300") >= 0 || StringFind(s, "BOOM 300") >= 0) return "Boom 300 Index";
   if(StringFind(s, "BOOM500") >= 0 || StringFind(s, "BOOM 500") >= 0) return "Boom 500 Index";
   if(StringFind(s, "BOOM600") >= 0 || StringFind(s, "BOOM 600") >= 0) return "Boom 600 Index";
   if(StringFind(s, "BOOM900") >= 0 || StringFind(s, "BOOM 900") >= 0) return "Boom 900 Index";

   // 3. Step Index
   if(StringFind(s, "STPRNG") >= 0 || StringFind(s, "STEP") >= 0) return FindBrokerSymbolMatch("Step Index", "Step 100 Index");

   // 4. Volatility (1s) Indices
   if(StringFind(s, "1HZ100V") >= 0 || (StringFind(s, "VOLATILITY 100") >= 0 && StringFind(s, "1S") >= 0)) return "Volatility 100 (1s) Index";
   if(StringFind(s, "1HZ75V") >= 0  || (StringFind(s, "VOLATILITY 75") >= 0  && StringFind(s, "1S") >= 0)) return "Volatility 75 (1s) Index";
   if(StringFind(s, "1HZ50V") >= 0  || (StringFind(s, "VOLATILITY 50") >= 0  && StringFind(s, "1S") >= 0)) return "Volatility 50 (1s) Index";
   if(StringFind(s, "1HZ25V") >= 0  || (StringFind(s, "VOLATILITY 25") >= 0  && StringFind(s, "1S") >= 0)) return "Volatility 25 (1s) Index";
   if(StringFind(s, "1HZ10V") >= 0  || (StringFind(s, "VOLATILITY 10") >= 0  && StringFind(s, "1S") >= 0)) return "Volatility 10 (1s) Index";

   // 5. Volatility (Normal) Indices
   if(s == "R_100" || StringFind(s, "VOLATILITY 100") >= 0) return "Volatility 100 Index";
   if(s == "R_75"  || StringFind(s, "VOLATILITY 75") >= 0)  return "Volatility 75 Index";
   if(s == "R_50"  || StringFind(s, "VOLATILITY 50") >= 0)  return "Volatility 50 Index";
   if(s == "R_25"  || StringFind(s, "VOLATILITY 25") >= 0)  return "Volatility 25 Index";
   if(s == "R_10"  || StringFind(s, "VOLATILITY 10") >= 0)  return "Volatility 10 Index";

   // 6. Jump Indices
   if(s == "JD100" || StringFind(s, "JUMP 100") >= 0) return "Jump 100 Index";
   if(s == "JD75"  || StringFind(s, "JUMP 75") >= 0)  return "Jump 75 Index";
   if(s == "JD50"  || StringFind(s, "JUMP 50") >= 0)  return "Jump 50 Index";
   if(s == "JD25"  || StringFind(s, "JUMP 25") >= 0)  return "Jump 25 Index";
   if(s == "JD10"  || StringFind(s, "JUMP 10") >= 0)  return "Jump 10 Index";

   // 7. Oro, Plata y Pares de Forex
   if(StringFind(s, "XAUUSD") >= 0) return FindBrokerSymbolMatch("XAUUSD", "GOLD");
   if(StringFind(s, "XAGUSD") >= 0) return FindBrokerSymbolMatch("XAGUSD", "SILVER");
   if(StringFind(s, "GBPJPY") >= 0) return FindBrokerSymbolMatch("GBPJPY");
   if(StringFind(s, "GBPUSD") >= 0) return FindBrokerSymbolMatch("GBPUSD");
   if(StringFind(s, "EURUSD") >= 0) return FindBrokerSymbolMatch("EURUSD");
   if(StringFind(s, "USDJPY") >= 0) return FindBrokerSymbolMatch("USDJPY");
   
   return webSymbol;
}

//+------------------------------------------------------------------+
//| Clasificar simbolo en bucket para limites de concurrencia        |
//| 0: Crash/Boom (max 3)                                            |
//| 1: XAUUSD (max 1)                                                |
//| 2: Otros indices y Forex (max 2)                                 |
//+------------------------------------------------------------------+
int GetSymbolBucket(string sym)
{
   string up = sym;
   StringToUpper(up);
   if(StringFind(up, "CRASH") >= 0 || StringFind(up, "BOOM") >= 0) return 0;
   if(StringFind(up, "XAU") >= 0 || StringFind(up, "GOLD") >= 0)   return 1;
   return 2;
}

//+------------------------------------------------------------------+
//| Obtener lotaje seguro segun el activo                           |
//+------------------------------------------------------------------+
double GetSafeLot(string sym, double desiredLot)
{
   double minLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double step   = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   
   if(minLot <= 0) minLot = 0.01;
   
   double lot = desiredLot;
   string s = sym;
   StringToUpper(s);
   if(StringFind(s, "CRASH 600") >= 0 || StringFind(s, "CRASH600") >= 0)
   {
      lot = 0.25;
   }
   else if(StringFind(s, "CRASH 300") >= 0 || StringFind(s, "CRASH300") >= 0)
   {
      lot = 0.50;
   }
   else if(lot <= 0)
   {
      int cat = GetSymbolCategory(sym);
      if(cat == 2)
      {
         lot = 0.05; // Forex y Metales
      }
      else if(cat == 1)
      {
         lot = 0.10; // Step, Jump, Volatility
      }
      else
      {
         if(StringFind(s, "CRASH 900") >= 0 || StringFind(s, "CRASH900") >= 0 ||
            StringFind(s, "BOOM 1000") >= 0 || StringFind(s, "BOOM1000") >= 0)
         {
            lot = 0.50;
         }
         else
         {
            lot = 1.00;
         }
      }
   }
   
   if(lot < minLot) lot = minLot;
   if(maxLot > 0 && lot > maxLot) lot = maxLot;
   
   if(step > 0)
   {
      lot = MathFloor(lot / step) * step;
      if(lot < minLot) lot = minLot;
   }
   return NormalizeDouble(lot, 2);
}

//+------------------------------------------------------------------+
//| Parser basico de JSON para cadenas y numeros                    |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string pattern = "\"" + key + "\":\"";
   int start = StringFind(json, pattern);
   if(start < 0) return "";
   start += StringLen(pattern);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

double ExtractJsonNumber(string json, string key)
{
   string pattern = "\"" + key + "\":";
   int start = StringFind(json, pattern);
   if(start < 0) return 0.0;
   start += StringLen(pattern);
   
   while(start < StringLen(json) && (StringGetCharacter(json, start) == ' ' || StringGetCharacter(json, start) == '\"'))
   {
      start++;
   }
   
   int end = start;
   while(end < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, end);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-') end++;
      else break;
   }
   if(end == start) return 0.0;
   return StringToDouble(StringSubstr(json, start, end - start));
}

bool IsAlreadyExecuted(string cmdId)
{
   for(int i = 0; i < ArraySize(executedCommands); i++)
   {
      if(executedCommands[i] == cmdId) return true;
   }
   return false;
}

void MarkAsExecuted(string cmdId)
{
   int sz = ArraySize(executedCommands);
   ArrayResize(executedCommands, sz + 1);
   executedCommands[sz] = cmdId;
}

//+------------------------------------------------------------------+
//| Escribir confirmacion en deriv_bridge_feedback.json              |
//+------------------------------------------------------------------+
void WriteFeedback(string cmdId, string tradeId, string status, ulong ticket, string msg)
{
   int hFile = FileOpen(feedbackFileName, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(hFile != INVALID_HANDLE)
   {
      FileSeek(hFile, 0, SEEK_END);
      long timeNow = (long)TimeCurrent();
      string entry = "{\"cmdId\":\"" + cmdId + "\",\"tradeId\":\"" + tradeId + "\",\"status\":\"" + status + "\",\"ticket\":" + (string)ticket + ",\"msg\":\"" + msg + "\",\"time\":" + (string)timeNow + "}\n";
      FileWriteString(hFile, entry);
      FileClose(hFile);
   }
}

//+------------------------------------------------------------------+
//| Procesar un comando individual de apertura o cierre              |
//+------------------------------------------------------------------+
void ProcessSingleCommand(string cmdJson)
{
   string cmdId   = ExtractJsonString(cmdJson, "id");
   string tradeId = ExtractJsonString(cmdJson, "tradeId");
   string action  = ExtractJsonString(cmdJson, "action");
   string rawSym  = ExtractJsonString(cmdJson, "symbol");
   string dir     = ExtractJsonString(cmdJson, "direction");
   double lot     = ExtractJsonNumber(cmdJson, "lot");
   double sl      = ExtractJsonNumber(cmdJson, "stopLossPrice");
   double tp      = ExtractJsonNumber(cmdJson, "takeProfitPrice");
   double score   = ExtractJsonNumber(cmdJson, "score");
   string viableStr = ExtractJsonString(cmdJson, "isHighlyViable");
   bool isViable  = (score >= 85.0 || viableStr == "true" || viableStr == "1");
   
   if(cmdId == "" || IsAlreadyExecuted(cmdId)) return;
   
   string mt5Sym = NormalizeSymbol(rawSym);
   string comment = "DerivApp_" + StringSubstr(tradeId, 0, 8);
   
   // Asegurar que el simbolo este activo en Observacion de Mercado
   if(!SymbolInfoInteger(mt5Sym, SYMBOL_SELECT))
   {
      SymbolSelect(mt5Sym, true);
   }
   
   // ── A. ACCION: APERTURA (OPEN) ──
   if(action == "OPEN")
   {
      // Candado estricto de concurrencia por grupo (Crash/Boom: 3, XAUUSD: 1, Otros: 2)
      int targetBucket = GetSymbolBucket(mt5Sym);
      int inBucketCount = 0;
      int totalBotCount = 0;
      for(int p = 0; p < PositionsTotal(); p++)
      {
         if(PositionGetTicket(p) > 0)
         {
            if(PositionGetInteger(POSITION_MAGIC) == BridgeMagicNumber)
            {
               totalBotCount++;
               string pSym = PositionGetString(POSITION_SYMBOL);
               if(GetSymbolBucket(pSym) == targetBucket)
               {
                  inBucketCount++;
               }
            }
         }
      }

      int bucketLimit = MaxOtherTrades;
      string bucketName = "Otros indices y Forex";
      if(targetBucket == 0)      { bucketLimit = MaxCrashBoomTrades; bucketName = "Crash/Boom"; }
      else if(targetBucket == 1) { bucketLimit = MaxXauusdTrades;    bucketName = "XAUUSD"; }

      // Candado Global Total: Maximo 6 trades simultaneos (3 Crash/Boom + 1 XAUUSD + 2 Otros)
      int maxTotalTrades = MaxCrashBoomTrades + MaxXauusdTrades + MaxOtherTrades;
      if(totalBotCount >= maxTotalTrades)
      {
         Print("⛔ [DerivApp Bridge] BLOQUEO CONCURRENCIA GLOBAL: Maximo total de ", maxTotalTrades, " trades simultaneos alcanzado en MT5 (actuales bot: ", totalBotCount, "). Orden ", mt5Sym, " descartada.");
         WriteFeedback(cmdId, tradeId, "REJECTED_MAX_CONCURRENT", 0, "Max total concurrent trades reached: " + (string)totalBotCount);
         MarkAsExecuted(cmdId);
         return;
      }

      if(inBucketCount >= bucketLimit)
      {
         Print("⛔ [DerivApp Bridge] BLOQUEO CONCURRENCIA [", bucketName, "]: Maximo de ", bucketLimit, " trades alcanzado en MT5 para este grupo (actuales en grupo: ", inBucketCount, ", total bot: ", totalBotCount, "). Orden ", mt5Sym, " descartada.");
         WriteFeedback(cmdId, tradeId, "REJECTED_MAX_CONCURRENT", 0, "Max concurrent trades reached for " + bucketName + ": " + (string)inBucketCount);
         MarkAsExecuted(cmdId);
         return;
      }

      // Candado Anti-Reentrada en Oro tras salida en Stop Loss (10 minutos)
      if(targetBucket == 1)
      {
         if(GlobalVariableCheck("DAPP_GOLD_SL_TIME"))
         {
            datetime lastSl = (datetime)GlobalVariableGet("DAPP_GOLD_SL_TIME");
            int elapsed = (int)(TimeCurrent() - lastSl);
            if(elapsed >= 0 && elapsed < 600)
            {
               int rem = 600 - elapsed;
               Print("⛔ [DerivApp Bridge] BLOQUEO SL ORO: XAUUSD salio en SL hace ", elapsed, "s. Esperando 10 minutos de enfriamiento (restan ", rem / 60, "m ", rem % 60, "s). Orden descartada.");
               WriteFeedback(cmdId, tradeId, "REJECTED_GOLD_SL_COOLDOWN", 0, "Oro en cooldown de 10 min tras salida en Stop Loss");
               MarkAsExecuted(cmdId);
               return;
            }
         }
      }

      // Candado de 30 minutos de espera tras salida en Stop Loss en el mismo indice
      string slGv = "DAPP_SL_" + mt5Sym;
      if(GlobalVariableCheck(slGv))
      {
         datetime lastSl = (datetime)GlobalVariableGet(slGv);
         int elapsed = (int)(TimeCurrent() - lastSl);
         if(elapsed >= 0 && elapsed < 1800) // 30 minutos
         {
            if(isViable)
            {
               Print("⚡ [DerivApp Bridge] Cooldown 30 min activo en ", mt5Sym, " (transcurridos ", elapsed, "s), pero orden AUTORIZADA por ALTA VIABILIDAD (Score: ", DoubleToString(score, 0), "% >= 85%).");
            }
            else
            {
               int rem = 1800 - elapsed;
               Print("⛔ [DerivApp Bridge] BLOQUEO SL 30 MIN: ", mt5Sym, " salio en SL hace ", elapsed, "s. Esperando 30 minutos de enfriamiento (restan ", rem / 60, "m ", rem % 60, "s). Orden descartada.");
               WriteFeedback(cmdId, tradeId, "REJECTED_SL_30MIN_COOLDOWN", 0, "Indice en enfriamiento de 30 min tras salida en SL");
               MarkAsExecuted(cmdId);
               return;
            }
         }
      }
      // Candado de seguridad estricto para sinteticos Deriv:
      if(StringFind(mt5Sym, "Boom") >= 0 && dir == "SELL")
      {
         Print("❌ [DerivApp Bridge] BLOQUEO: Prohibido abrir SELL en indices Boom (", mt5Sym, "). Solo BUY.");
         WriteFeedback(cmdId, tradeId, "REJECTED", 0, "Prohibido SELL en Boom");
         MarkAsExecuted(cmdId);
         return;
      }
      if(StringFind(mt5Sym, "Crash") >= 0 && dir == "BUY")
      {
         Print("❌ [DerivApp Bridge] BLOQUEO: Prohibido abrir BUY en indices Crash (", mt5Sym, "). Solo SELL.");
         WriteFeedback(cmdId, tradeId, "REJECTED", 0, "Prohibido BUY en Crash");
         MarkAsExecuted(cmdId);
         return;
      }

      // Candado anti-duplicacion por comentario (mismo tradeId)
      for(int p = 0; p < PositionsTotal(); p++)
      {
         if(PositionGetTicket(p) > 0)
         {
            string pComm = PositionGetString(POSITION_COMMENT);
            if(pComm == comment && comment != "DerivApp_")
            {
               Print("ℹ️ [DerivApp Bridge] Ya existe una posicion activa para este tradeId (", comment, "). Omitiendo duplicada.");
               MarkAsExecuted(cmdId);
               return;
            }
         }
      }
      
      // Asegurar que el símbolo esté activo en la Observación del Mercado (Market Watch)
      SymbolSelect(mt5Sym, true);

      double point = SymbolInfoDouble(mt5Sym, SYMBOL_POINT);
      int digits = (int)SymbolInfoInteger(mt5Sym, SYMBOL_DIGITS);
      double minStopDist = SymbolInfoInteger(mt5Sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
      if(minStopDist <= 0) minStopDist = 50 * point;
      
      double ask = SymbolInfoDouble(mt5Sym, SYMBOL_ASK);
      double bid = SymbolInfoDouble(mt5Sym, SYMBOL_BID);
      
      // Si ask/bid están en 0, intentar leer tick directamente
      if(ask <= 0 || bid <= 0)
      {
         MqlTick lastTick;
         if(SymbolInfoTick(mt5Sym, lastTick))
         {
            ask = lastTick.ask;
            bid = lastTick.bid;
         }
      }
      
      if(ask <= 0 || bid <= 0)
      {
         Print("❌ [DerivApp Bridge] Símbolo no disponible o sin cotizaciones en MT5: ", mt5Sym, " (Ask: ", ask, ", Bid: ", bid, ")");
         WriteFeedback(cmdId, tradeId, "ERROR", 0, "Symbol has no quotes in MT5: " + mt5Sym);
         MarkAsExecuted(cmdId);
         return;
      }

      double safeLot = GetSafeLot(mt5Sym, lot);
      bool success = false;

      // REGLA EXPRESA DEL USUARIO: NUNCA marcar SL ni TP en las ordenes de MT5 (sl = 0.0, tp = 0.0).
      // Todo el SL (8 min en Crash/Boom, 7 USD en Sinteticos, 8 USD en Forex) y Trailing Stop (60% / 50%)
      // se gestiona internamente de forma virtual/oculta.
      sl = 0.0;
      tp = 0.0;

      // Cada indice puede exigir un modo de llenado diferente.
      trade.SetTypeFillingBySymbol(mt5Sym);

      if(dir == "BUY")
      {
         success = trade.Buy(safeLot, mt5Sym, ask, 0.0, 0.0, comment);
      }
      else if(dir == "SELL")
      {
         success = trade.Sell(safeLot, mt5Sym, bid, 0.0, 0.0, comment);
      }
      
      ulong dealTicket = trade.ResultDeal();
      ulong orderTicket = trade.ResultOrder();
      ulong retCode = trade.ResultRetcode();
      string retDesc = trade.ResultRetcodeDescription();
      
      if(success)
      {
         ulong finalTicket = orderTicket > 0 ? orderTicket : dealTicket;
         double rawSl = ExtractJsonNumber(cmdJson, "stopLossPrice");
         if(rawSl > 0.0 && finalTicket > 0)
         {
            GlobalVariableSet("DAPP_TSL_" + (string)finalTicket, rawSl);
         }
         Print("✅ [DerivApp Bridge] Orden MT5 EJECUTADA: ", mt5Sym, " (", dir, ") Lote: ", safeLot, " Ticket: ", finalTicket, (rawSl > 0.0 ? " [SL Técnico: " + DoubleToString(rawSl, 3) + "]" : ""));
         WriteFeedback(cmdId, tradeId, "EXECUTED", finalTicket, retDesc);
         MarkAsExecuted(cmdId);
      }
      else
      {
         Print("❌ [DerivApp Bridge] Error abriendo orden MT5: ", retDesc, " (RetCode: ", retCode, ")");
         WriteFeedback(cmdId, tradeId, "ERROR", 0, retDesc);
         MarkAsExecuted(cmdId);
      }
   }
   // ── B. ACCION: CIERRE (CLOSE) ──
   else if(action == "CLOSE")
   {
      bool closed = false;
      ulong targetTicket = (ulong)ExtractJsonNumber(cmdJson, "ticket");
       string reason = ExtractJsonString(cmdJson, "reason");

      // 1. Si viene ticket específico, verificar Magic Number antes de cerrar
      if(targetTicket > 0)
      {
         if(PositionSelectByTicket(targetTicket))
         {
            ulong posMagic = PositionGetInteger(POSITION_MAGIC);
            if(posMagic == BridgeMagicNumber || ProtectAllPositions)
            {
               closed = trade.PositionClose(targetTicket);
               if(closed)
               {
                  Print("🏁 [DerivApp Bridge] Posicion cerrada por ticket en MT5. Ticket: ", targetTicket, " Motivo: ", reason);
                  GlobalVariableDel("DAPP_MAXP_" + (string)targetTicket);
                  GlobalVariableDel("DAPP_SPIKE_" + (string)targetTicket);
                  GlobalVariableDel("DAPP_COV_" + (string)targetTicket);
                  WriteFeedback(cmdId, tradeId, "CLOSED", targetTicket, "Closed OK: " + reason);
               }
               else
               {
                  Print("⚠️ [DerivApp Bridge] No se pudo cerrar por ticket: ", targetTicket, " RetCode: ", trade.ResultRetcode());
               }
            }
            else
            {
               Print("🛡️ [DerivApp Bridge] Omitiendo cierre de ticket #", targetTicket, ": Es una operacion MANUAL (Magic: ", posMagic, "). El bot solo gestiona sus propias operaciones.");
               WriteFeedback(cmdId, tradeId, "IGNORED_MANUAL", targetTicket, "Manual trade ignored");
               closed = true; // Para evitar que caiga a la busqueda por simbolo y cierre otra cosa
            }
         }
      }

      // 2. Si no se especificó ticket o no cerró, buscar SOLO por tradeId en el comentario (evitar cerrar posiciones arbitrarias del símbolo)
      if(!closed && StringLen(tradeId) > 0)
      {
         for(int i = PositionsTotal() - 1; i >= 0; i--)
         {
            ulong ticket = PositionGetTicket(i);
            if(ticket > 0)
            {
               ulong  posMagic = PositionGetInteger(POSITION_MAGIC);
               
               // NUNCA cerrar posiciones manuales por símbolo a menos que ProtectAllPositions sea true
               if(posMagic != BridgeMagicNumber && !ProtectAllPositions) continue;

               string posSym = PositionGetString(POSITION_SYMBOL);
               string posComment = PositionGetString(POSITION_COMMENT);

               if(posSym == mt5Sym && (posComment == comment || StringFind(posComment, tradeId) >= 0))
               {
                  closed = trade.PositionClose(ticket);
                  if(closed)
                  {
                     Print("🏁 [DerivApp Bridge] Posicion del bot cerrada por coincidencia de tradeId en MT5. Ticket: ", ticket, " (Magic: ", posMagic, ")");
                     WriteFeedback(cmdId, tradeId, "CLOSED", ticket, "Closed OK by tradeId match");
                  }
                  break;
               }
            }
         }
      }
      if(closed && GetSymbolBucket(mt5Sym) == 1 && (StringFind(reason, "SL") >= 0 || StringFind(reason, "LOSS") >= 0))
      {
         GlobalVariableSet("DAPP_GOLD_SL_TIME", (double)TimeCurrent());
         Print("⏳ [DerivApp Bridge] Cooldown de 10 minutos activado para XAUUSD tras salida en Stop Loss.");
      }
      MarkAsExecuted(cmdId);
   }
}

//+------------------------------------------------------------------+
//| Exportar posiciones abiertas en MT5 a JSON para la App Web       |
//+------------------------------------------------------------------+
void ExportOpenPositions()
{
   int total = PositionsTotal();
   string json = "[";
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      
      ulong magic = PositionGetInteger(POSITION_MAGIC);
      string sym = PositionGetString(POSITION_SYMBOL);
      long posType = PositionGetInteger(POSITION_TYPE);
      double vol = PositionGetDouble(POSITION_VOLUME);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double profit = PositionGetDouble(POSITION_PROFIT);
      long time = PositionGetInteger(POSITION_TIME);
      
      if(count > 0) json += ",";
      json += StringFormat("{\"ticket\":%I64u,\"magic\":%I64u,\"symbol\":\"%s\",\"type\":\"%s\",\"volume\":%.2f,\"openPrice\":%.3f,\"currentPrice\":%.3f,\"sl\":%.3f,\"tp\":%.3f,\"profit\":%.2f,\"time\":%I64d}",
         ticket, magic, sym, (posType == POSITION_TYPE_BUY ? "BUY" : "SELL"), vol, openPrice, currentPrice, sl, tp, profit, time);
      count++;
   }
   json += "]";
   
   int h = FileOpen("deriv_bridge_positions.json", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h != INVALID_HANDLE)
   {
      FileWriteString(h, json);
      FileClose(h);
   }
}

//+------------------------------------------------------------------+
//| Exportar historial real de operaciones cerradas de hoy a JSON    |
//+------------------------------------------------------------------+
int historyExportCounter = 0;
void ExportClosedTradesHistory()
{
   MqlDateTime dt;
   TimeCurrent(dt);
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   datetime startOfDay = StructToTime(dt);
   
   if(!HistorySelect(startOfDay, TimeCurrent())) return;
   
   int totalDeals = HistoryDealsTotal();
   string json = "[";
   int count = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= 0) continue;
      
      long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      // Solo transacciones de salida (cierre de posición)
      if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_INOUT) continue;
      
      ulong orderTicket = HistoryDealGetInteger(dealTicket, DEAL_ORDER);
      ulong positionId  = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      ulong magic       = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      string sym        = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long dealType     = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      double vol        = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      double profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      double swap       = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
      double comm       = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      long closeTime    = HistoryDealGetInteger(dealTicket, DEAL_TIME);
      string comment    = HistoryDealGetString(dealTicket, DEAL_COMMENT);
      
      double openPrice = 0.0;
      long openTime    = closeTime;
      for(int j = 0; j < totalDeals; j++)
      {
         ulong inTicket = HistoryDealGetTicket(j);
         if(inTicket > 0 && HistoryDealGetInteger(inTicket, DEAL_POSITION_ID) == positionId)
         {
            if(HistoryDealGetInteger(inTicket, DEAL_ENTRY) == DEAL_ENTRY_IN)
            {
               openPrice = HistoryDealGetDouble(inTicket, DEAL_PRICE);
               openTime  = HistoryDealGetInteger(inTicket, DEAL_TIME);
               break;
            }
         }
      }
      
      string origDirection = (dealType == DEAL_TYPE_BUY) ? "SELL" : "BUY";
      double netTotalProfit = profit + swap + comm;
      
      if(count > 0) json += ",";
      json += StringFormat("{\"dealTicket\":%I64u,\"orderTicket\":%I64u,\"positionId\":%I64u,\"magic\":%I64u,\"symbol\":\"%s\",\"direction\":\"%s\",\"volume\":%.2f,\"openPrice\":%.3f,\"closePrice\":%.3f,\"profit\":%.2f,\"netProfit\":%.2f,\"openTime\":%I64d,\"closeTime\":%I64d,\"comment\":\"%s\"}",
         dealTicket, orderTicket, positionId, magic, sym, origDirection, vol, openPrice, closePrice, profit, netTotalProfit, openTime, closeTime, comment);
      count++;
   }
   json += "]";
   
   int h = FileOpen("deriv_bridge_history.json", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h != INVALID_HANDLE)
   {
      FileWriteString(h, json);
      FileClose(h);
   }
}


//+------------------------------------------------------------------+
//| Preseleccionar y registrar todos los símbolos Crash y Boom       |
//+------------------------------------------------------------------+
void SelectAllCrashBoomSymbols()
{
   int total = SymbolsTotal(false);
   int h = FileOpen("deriv_symbols_diagnostic.txt", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h != INVALID_HANDLE)
   {
      FileWriteString(h, "=== TOTAL SIMBOLOS BROKER: " + (string)total + " ===\r\n");
   }
   
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      string s = name;
      StringToUpper(s);
      if(StringFind(s, "CRASH") >= 0 || StringFind(s, "BOOM") >= 0 ||
         StringFind(s, "STEP") >= 0 || StringFind(s, "VOLATILITY") >= 0 ||
         StringFind(s, "JUMP") >= 0 || StringFind(s, "XAU") >= 0 ||
         StringFind(s, "XAG") >= 0 || StringFind(s, "EURUSD") >= 0 ||
         StringFind(s, "GBPUSD") >= 0 || StringFind(s, "GBPJPY") >= 0 ||
         StringFind(s, "USDJPY") >= 0)
      {
         SymbolSelect(name, true);
         if(h != INVALID_HANDLE)
         {
            double bid = SymbolInfoDouble(name, SYMBOL_BID);
            double ask = SymbolInfoDouble(name, SYMBOL_ASK);
            FileWriteString(h, name + " | inWatch: YES | Bid: " + DoubleToString(bid, 3) + " | Ask: " + DoubleToString(ask, 3) + "\r\n");
         }
      }
   }
   if(h != INVALID_HANDLE) FileClose(h);
}

//+------------------------------------------------------------------+
//| Exportar velas M5 cerradas de MT5 para la estrategia M5X         |
//+------------------------------------------------------------------+
void ExportM5XCandlesForSymbol(string webSymbol)
{
   string mt5Symbol = NormalizeSymbol(webSymbol);
   if(!SymbolSelect(mt5Symbol, true))
   {
      Print("[M5X] No se pudo seleccionar ", mt5Symbol);
      return;
   }

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int requested = MathMax(100, M5XHistoryCandles);
   int copied = CopyRates(mt5Symbol, PERIOD_M5, 0, requested, rates);
   if(copied <= 1)
   {
      Print("[M5X] Sin historial M5 suficiente para ", mt5Symbol, ". Error: ", GetLastError());
      return;
   }

   string fileName = "deriv_bridge_m5_" + webSymbol + ".json";
   int h = FileOpen(fileName, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE)
   {
      Print("[M5X] No se pudo abrir ", fileName, ". Error: ", GetLastError());
      return;
   }

   datetime currentM5Open = iTime(mt5Symbol, PERIOD_M5, 0);
   FileWriteString(h, "[");
   int written = 0;
   for(int i = 0; i < copied; i++)
   {
      // La vela cero todavia esta formandose y nunca se usa en M5X.
      if(rates[i].time >= currentM5Open) continue;
      if(written > 0) FileWriteString(h, ",");
      string row = StringFormat(
         "{\"symbol\":\"%s\",\"epoch\":%I64d,\"open\":%.8f,\"high\":%.8f,\"low\":%.8f,\"close\":%.8f}",
         webSymbol,
         (long)rates[i].time,
         rates[i].open,
         rates[i].high,
         rates[i].low,
         rates[i].close
      );
      FileWriteString(h, row);
      written++;
   }
   FileWriteString(h, "]");
   FileClose(h);
   Print("[M5X] ", written, " velas M5 de ", mt5Symbol, " exportadas a ", fileName);
}

void ExportM5XCandles()
{
   string symbols[] = {
      "CRASH100", "CRASH200", "CRASH300N", "CRASH500",
      "CRASH600", "CRASH900", "CRASH1000"
   };
   for(int i = 0; i < ArraySize(symbols); i++)
      ExportM5XCandlesForSymbol(symbols[i]);
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(BridgeMagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);
   trade.SetTypeFilling(ORDER_FILLING_FOK);
   
   // Preseleccionar en Observación del Mercado todos los índices Crash y Boom
   SelectAllCrashBoomSymbols();

   // Primera exportacion inmediata del historial exacto que muestra MetaTrader.
   ExportM5XCandles();

   EventSetMillisecondTimer(PollIntervalMs);
   
   Print("════════════════════════════════════════════════════════════════");
   Print("🚀 [DerivApp Bridge EA] ACTIVO en cuenta: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("   Servidor: ", AccountInfoString(ACCOUNT_SERVER));
   Print("   Sincronizando operaciones con Deriv App Web...");
   Print("════════════════════════════════════════════════════════════════");
   
   Comment("🟢 Deriv App Bridge ACTIVO\nCuenta: ", AccountInfoInteger(ACCOUNT_LOGIN), " (", AccountInfoString(ACCOUNT_SERVER), ")\nOperaciones sincronizadas con Deriv App Web");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

//+------------------------------------------------------------------+
//| Monitoreo de cotizaciones y permisos de trading para 100 y 200   |
//+------------------------------------------------------------------+
int quoteCheckCounter = 0;
void CheckQuotes100_200()
{
   string syms[] = {"Crash 100 Index", "Crash 200 Index", "Boom 100 Index", "Boom 200 Index"};
   int h = FileOpen("deriv_100_200_status.txt", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE) return;
   
   for(int i = 0; i < 4; i++)
   {
      string s = syms[i];
      SymbolSelect(s, true);
      MqlTick t;
      bool hasTick = SymbolInfoTick(s, t);
      long tradeMode = SymbolInfoInteger(s, SYMBOL_TRADE_MODE);
      double minLot = SymbolInfoDouble(s, SYMBOL_VOLUME_MIN);
      double maxLot = SymbolInfoDouble(s, SYMBOL_VOLUME_MAX);
      double step = SymbolInfoDouble(s, SYMBOL_VOLUME_STEP);
      
      FileWriteString(h, s + " | tick: " + (hasTick ? "YES" : "NO") + " | Bid: " + DoubleToString(t.bid, 3) + " | Ask: " + DoubleToString(t.ask, 3) + " | TradeMode: " + (string)tradeMode + " | MinLot: " + DoubleToString(minLot, 2) + "\r\n");
   }
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Expert timer function                                            |
//+------------------------------------------------------------------+
void OnTimer()
{
   ManageNoSpikeTimeout();
   // 1. Sincronizar en tiempo real las posiciones abiertas de MT5 hacia la Web App
   ExportOpenPositions();

   // 2. Proteger siempre el 70% del profit maximo alcanzado
   ProtectProfitTarget();

   // 2a. Control de Stop Loss técnico virtual (Order Block)
   CheckTechnicalStopLoss();

   // 2b. Control estricto de Stop Loss monetario (-5 USD general / -8 USD Crash 600)
   CheckMonetaryStopLoss();

   // 3. Sincronizar el historial real de operaciones cerradas de hoy hacia la Web App cada ~2 segundos
   if(++historyExportCounter >= 5)
   {
      historyExportCounter = 0;
      ExportClosedTradesHistory();
   }

   // Limpieza periódica de variables globales cada ~10 segundos
   if(++gvCleanupCounter >= 25)
   {
      gvCleanupCounter = 0;
      CleanupOrphanedGlobalVariables();
   }

   // Diagnóstico de cotizaciones de 100 y 200 cada ~2 segundos
   if(++quoteCheckCounter >= 5)
   {
      quoteCheckCounter = 0;
      CheckQuotes100_200();
   }

   // Refrescar el historial M5X aproximadamente cada 5 minutos.
   int m5XRefreshTicks = (int)MathMax(1, 300000 / MathMax(1, PollIntervalMs));
   if(++m5XExportCounter >= m5XRefreshTicks)
   {
      m5XExportCounter = 0;
      ExportM5XCandles();
   }

   // 3. Leer archivo de comandos generado por el backend
   int hFile = FileOpen(commandsFileName, FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(hFile == INVALID_HANDLE) return;
   
   string content = "";
   while(!FileIsEnding(hFile))
   {
      content += FileReadString(hFile);
   }
   FileClose(hFile);
   
   if(StringLen(content) < 10) return;
   
   // Limpiar comandos procesados INMEDIATAMENTE para que cualquier comando nuevo escrito
   // por el backend mientras se ejecutan las órdenes en MT5 NO sea sobreescrito ni borrado
   int hClear = FileOpen(commandsFileName, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(hClear != INVALID_HANDLE)
   {
      FileWriteString(hClear, "");
      FileClose(hClear);
   }
   
   // Extraer y procesar bloques de comando { ... }
   int searchPos = 0;
   while(true)
   {
      int startObj = StringFind(content, "{", searchPos);
      if(startObj < 0) break;
      int endObj = StringFind(content, "}", startObj);
      if(endObj < 0) break;
      
      string cmdJson = StringSubstr(content, startObj, endObj - startObj + 1);
      searchPos = endObj + 1;
      
      ProcessSingleCommand(cmdJson);
   }
}
