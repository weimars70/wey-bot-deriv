//+------------------------------------------------------------------+
//| Boom & Crash AI Expert Advisor v2.3                              |
//| Intelligent prediction, auto broker detection, ML analysis       |
//| FIX: Symbol detection debugging and initialization issues        |
//+------------------------------------------------------------------+
#property copyright "AI Trading Systems"
#property link      "https://github.com/Osikani5634/boom-crash-ai-ea"
#property version   "2.3"
#property strict
#property description "AI EA for Boom/Crash 1000,900,600,500,300,150,50"

#include <Trade\Trade.mqh>

//+------------------------------------------------------------------+
// ENUMS & STRUCTURES
//+------------------------------------------------------------------+
enum BOOM_CRASH_INDICES {
    BOOM_1000,
    BOOM_900,
    BOOM_600,
    BOOM_500,
    BOOM_300,
    BOOM_150,
    BOOM_50,
    CRASH_1000,
    CRASH_900,
    CRASH_600,
    CRASH_500,
    CRASH_300,
    CRASH_150,
    CRASH_50
};

enum SIGNAL_TYPE {
    SIGNAL_BUY = 1,
    SIGNAL_SELL = -1,
    SIGNAL_EXIT = 0,
    SIGNAL_MULTI_SPIKE = 2
};

struct ML_Prediction {
    double confidence;
    SIGNAL_TYPE signal;
    double price_target;
    double spike_probability;
    int time_to_spike;
};

struct TradeData {
    ulong ticket;
    SIGNAL_TYPE entry_signal;
    double entry_price;
    datetime entry_time;
    double max_profit;
    double max_loss;
    bool is_active;
};

//+------------------------------------------------------------------+
// INPUT PARAMETERS
//+------------------------------------------------------------------+
input BOOM_CRASH_INDICES IndicesType = BOOM_300;
input double FixedLotSize = 0.10;
input double TakeProfitPips = 50;
input double StopLossPips = 30;
input int LookbackBars = 100;
input int MLAnalysisPeriod = 50;
input bool UseAutoTakeProfit = true;
input bool UseAutoStopLoss = true;
input bool ShowChartSignals = true;
input bool EnableWindowAlerts = true;
input bool EnableAutoTrading = true;
input int MaxOpenTrades = 10;
input bool OpenAllPositionsAtOnce = true;
input string ManualBrokerSymbol = "";  // Override symbol detection

//+------------------------------------------------------------------+
// GLOBAL VARIABLES
//+------------------------------------------------------------------+
CTrade trade;
string BrokerSymbol = "";
string SymbolSuffix = "";
ML_Prediction current_prediction;
TradeData active_trades[100];
int total_trades = 0;
double spike_history[1000];
int spike_index = 0;
double volatility_buffer[1000];
int volatility_index = 0;
int last_signal_bar = -1;
bool all_positions_opened = false;

//+------------------------------------------------------------------+
// INITIALIZATION
//+------------------------------------------------------------------+
int OnInit() {
    Print("=== Boom & Crash AI EA v2.3 Initializing ===");
    Print("Selected Index Type: ", IndicesType);
    
    // Use manual symbol if provided
    if (ManualBrokerSymbol != "") {
        BrokerSymbol = ManualBrokerSymbol;
        Print("Using manual broker symbol: ", BrokerSymbol);
    } else {
        // Auto-detect symbol
        if (!DetectBrokerSymbol()) {
            Print("ERROR: Failed to detect broker symbol for index type: ", IndicesType);
            Print("Available symbols in market watch:");
            PrintAvailableSymbols();
            Alert("Failed to detect broker symbol! Check journal for available symbols.");
            return INIT_FAILED;
        }
    }
    
    Print("Broker Symbol: ", BrokerSymbol);
    
    // Validate symbol exists and is in market watch
    if (!SymbolSelect(BrokerSymbol, true)) {
        Print("ERROR: Symbol not found or cannot be added to market watch: ", BrokerSymbol);
        Alert("Symbol not found: " + BrokerSymbol);
        return INIT_FAILED;
    }
    
    // Get symbol info
    if (!SymbolInfoDouble(BrokerSymbol, SYMBOL_BID) || !SymbolInfoDouble(BrokerSymbol, SYMBOL_ASK)) {
        Print("ERROR: Cannot get bid/ask prices for symbol: ", BrokerSymbol);
        Alert("Cannot get market data for symbol: " + BrokerSymbol);
        return INIT_FAILED;
    }
    
    Print("Symbol Suffix: ", SymbolSuffix);
    Print("Fixed Lot Size: ", FixedLotSize);
    Print("Bid: ", SymbolInfoDouble(BrokerSymbol, SYMBOL_BID), " Ask: ", SymbolInfoDouble(BrokerSymbol, SYMBOL_ASK));
    
    trade.SetExpertMagicNumber(GetMagicNumber());
    trade.SetDeviationInPoints(10);
    
    // Initialize arrays
    ArrayInitialize(spike_history, 0);
    ArrayInitialize(volatility_buffer, 0);
    
    Print("✓ EA initialized successfully!");
    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
// PRINT AVAILABLE SYMBOLS FOR DEBUGGING
//+------------------------------------------------------------------+
void PrintAvailableSymbols() {
    Print("--- Available Symbols in Market Watch ---");
    int count = 0;
    
    // Get all symbols from market watch
    for (int i = 0; i < 500; i++) {
        string sym = SymbolName(i, true);
        if (sym == "") break;
        
        // Print boom/crash related symbols
        if (StringFind(sym, "oom") != -1 || StringFind(sym, "rash") != -1 || 
            StringFind(sym, "300") != -1 || StringFind(sym, "150") != -1 ||
            StringFind(sym, "50") != -1) {
            Print(sym);
            count++;
        }
    }
    
    if (count == 0) {
        Print("No Boom/Crash symbols found! Add them to Market Watch first.");
    }
}

//+------------------------------------------------------------------+
// MAIN TICK FUNCTION
//+------------------------------------------------------------------+
void OnTick() {
    // Collect historical data for ML analysis
    CollectMarketData();
    
    // Perform ML prediction
    current_prediction = AnalyzeWithML();
    
    // Display signals on chart
    if (ShowChartSignals) {
        DrawChartSignals();
    }
    
    // Execute trade logic
    ExecuteTradeLogic();
    
    // Manage active trades
    ManageActiveTrades();
    
    // Send alerts
    if (EnableWindowAlerts && current_prediction.confidence > 0.75) {
        SendAlert();
    }
}

//+------------------------------------------------------------------+
// AUTO BROKER SYMBOL DETECTION (IMPROVED)
//+------------------------------------------------------------------+
bool DetectBrokerSymbol() {
    string base_name = GetIndexName();
    Print("Searching for base index name: ", base_name);
    
    // Search in market watch first
    for (int i = 0; i < 500; i++) {
        string sym = SymbolName(i, true);
        if (sym == "") break;
        
        // Check for exact or partial matches
        string upper_sym = sym;
        StringToUpper(upper_sym);
        string upper_base = base_name;
        StringToUpper(upper_base);
        
        if (StringFind(upper_sym, upper_base) != -1) {
            BrokerSymbol = sym;
            Print("Found symbol in market watch: ", sym);
            return true;
        }
    }
    
    // Try standard naming conventions
    string suffixes[] = { "", ".f", ".txt", "_f", "_txt", "#", "m" };
    
    for (int j = 0; j < ArraySize(suffixes); j++) {
        string test_symbol = base_name + suffixes[j];
        if (SymbolSelect(test_symbol, false)) {
            BrokerSymbol = test_symbol;
            SymbolSuffix = suffixes[j];
            Print("Found symbol with suffix: ", test_symbol);
            return true;
        }
    }
    
    // Try uppercase variations
    for (int j = 0; j < ArraySize(suffixes); j++) {
        string upper_base = base_name;
        StringToUpper(upper_base);
        string test_symbol = upper_base + suffixes[j];
        if (SymbolSelect(test_symbol, false)) {
            BrokerSymbol = test_symbol;
            SymbolSuffix = suffixes[j];
            Print("Found symbol (uppercase): ", test_symbol);
            return true;
        }
    }
    
    // Try lowercase variations
    for (int j = 0; j < ArraySize(suffixes); j++) {
        string lower_base = base_name;
        StringToLower(lower_base);
        string test_symbol = lower_base + suffixes[j];
        if (SymbolSelect(test_symbol, false)) {
            BrokerSymbol = test_symbol;
            SymbolSuffix = suffixes[j];
            Print("Found symbol (lowercase): ", test_symbol);
            return true;
        }
    }
    
    return false;
}

//+------------------------------------------------------------------+
// GET INDEX NAME BASED ON TYPE
//+------------------------------------------------------------------+
string GetIndexName() {
    switch (IndicesType) {
        case BOOM_1000: return "Boom1000";
        case BOOM_900: return "Boom900";
        case BOOM_600: return "Boom600";
        case BOOM_500: return "Boom500";
        case BOOM_300: return "Boom300";
        case BOOM_150: return "Boom150";
        case BOOM_50: return "Boom50";
        case CRASH_1000: return "Crash1000";
        case CRASH_900: return "Crash900";
        case CRASH_600: return "Crash600";
        case CRASH_500: return "Crash500";
        case CRASH_300: return "Crash300";
        case CRASH_150: return "Crash150";
        case CRASH_50: return "Crash50";
        default: return "Boom1000";
    }
}

//+------------------------------------------------------------------+
// COLLECT MARKET DATA FOR ML
//+------------------------------------------------------------------+
void CollectMarketData() {
    MqlRates rates[];
    ArraySetAsSeries(rates, true);
    
    if (CopyRates(BrokerSymbol, PERIOD_M1, 0, LookbackBars, rates) <= 0) {
        return;
    }
    
    // Store volatility data
    double current_volatility = CalculateVolatility(rates);
    volatility_buffer[volatility_index % 1000] = current_volatility;
    volatility_index++;
    
    // Store price spikes
    if (ArraySize(rates) > 1) {
        double price_change = MathAbs(rates[0].close - rates[1].close);
        spike_history[spike_index % 1000] = price_change;
        spike_index++;
    }
}

//+------------------------------------------------------------------+
// CALCULATE VOLATILITY
//+------------------------------------------------------------------+
double CalculateVolatility(MqlRates &rates[]) {
    double sum_squared = 0;
    int count = MathMin(20, ArraySize(rates) - 1);
    
    if (count <= 0) return 0;
    
    for (int i = 0; i < count; i++) {
        if (rates[i + 1].close == 0) continue;
        double returns = (rates[i].close - rates[i + 1].close) / rates[i + 1].close;
        sum_squared += returns * returns;
    }
    
    return MathSqrt(sum_squared / count) * 100;
}

//+------------------------------------------------------------------+
// ML ANALYSIS & PREDICTION
//+------------------------------------------------------------------+
ML_Prediction AnalyzeWithML() {
    ML_Prediction pred;
    pred.confidence = 0;
    pred.signal = SIGNAL_EXIT;
    pred.spike_probability = 0;
    pred.time_to_spike = 0;
    
    MqlRates rates[];
    ArraySetAsSeries(rates, true);
    
    if (CopyRates(BrokerSymbol, PERIOD_M1, 0, MLAnalysisPeriod, rates) <= 0) {
        return pred;
    }
    
    // Feature 1: Volatility Spike Detection
    double current_vol = CalculateVolatility(rates);
    double avg_vol = CalculateAverageVolatility();
    double vol_ratio = current_vol / (avg_vol > 0.0001 ? avg_vol : 0.0001);
    
    // Feature 2: Price Momentum
    double momentum = CalculateMomentum(rates);
    
    // Feature 3: Mean Reversion Signal
    double mean_reversion = CalculateMeanReversion(rates);
    
    // Feature 4: RSI Signal
    double rsi = CalculateRSI(rates);
    
    // Buy Signal Conditions
    if (vol_ratio > 1.5 && momentum > 0.5 && rsi < 70) {
        pred.signal = SIGNAL_BUY;
        pred.confidence = (vol_ratio - 1) * 0.3 + momentum * 0.4 + (1 - rsi/100) * 0.3;
        pred.spike_probability = pred.confidence;
        pred.time_to_spike = DetectTimeToSpike(rates);
    }
    // Sell Signal Conditions
    else if (vol_ratio > 1.5 && momentum < -0.5 && rsi > 30) {
        pred.signal = SIGNAL_SELL;
        pred.confidence = (vol_ratio - 1) * 0.3 + MathAbs(momentum) * 0.4 + (rsi/100) * 0.3;
        pred.spike_probability = pred.confidence;
        pred.time_to_spike = DetectTimeToSpike(rates);
    }
    // Multiple Spikes Detection
    else if (vol_ratio > 2.0 && mean_reversion > 0.7) {
        pred.signal = SIGNAL_MULTI_SPIKE;
        pred.confidence = MathMin(0.99, vol_ratio * 0.3 + mean_reversion * 0.7);
        pred.spike_probability = pred.confidence;
    }
    
    pred.price_target = CalculatePriceTarget(rates, pred.signal);
    
    return pred;
}

//+------------------------------------------------------------------+
// CALCULATE AVERAGE VOLATILITY
//+------------------------------------------------------------------+
double CalculateAverageVolatility() {
    double sum = 0;
    int count = 0;
    
    for (int i = 0; i < MathMin(50, volatility_index); i++) {
        sum += volatility_buffer[i];
        count++;
    }
    
    return count > 0 ? sum / count : 0;
}

//+------------------------------------------------------------------+
// CALCULATE MOMENTUM
//+------------------------------------------------------------------+
double CalculateMomentum(MqlRates &rates[]) {
    int period = 10;
    int count = MathMin(period, ArraySize(rates) - 1);
    
    if (count <= 0 || rates[count - 1].close == 0) return 0;
    
    double momentum = (rates[0].close - rates[count - 1].close) / rates[count - 1].close;
    return momentum;
}

//+------------------------------------------------------------------+
// CALCULATE MEAN REVERSION
//+------------------------------------------------------------------+
double CalculateMeanReversion(MqlRates &rates[]) {
    double sum = 0;
    int count = MathMin(20, ArraySize(rates));
    
    if (count <= 0) return 0;
    
    for (int i = 0; i < count; i++) {
        sum += rates[i].close;
    }
    
    double mean = sum / count;
    if (mean == 0) return 0;
    
    double current = rates[0].close;
    double deviation = MathAbs(current - mean) / mean;
    
    return MathMin(1.0, deviation);
}

//+------------------------------------------------------------------+
// CALCULATE RSI
//+------------------------------------------------------------------+
double CalculateRSI(MqlRates &rates[]) {
    int period = 14;
    double gains = 0, losses = 0;
    int count = MathMin(period, ArraySize(rates) - 1);
    
    if (count <= 0) return 50;
    
    for (int i = 0; i < count; i++) {
        double change = rates[i].close - rates[i + 1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    double avg_gain = gains / count;
    double avg_loss = losses / count;
    double rs = avg_loss > 0.00001 ? avg_gain / avg_loss : 1;
    double rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}

//+------------------------------------------------------------------+
// CALCULATE ATR
//+------------------------------------------------------------------+
double CalculateATR(MqlRates &rates[]) {
    int period = 14;
    double sum = 0;
    int count = MathMin(period, ArraySize(rates) - 1);
    
    if (count <= 0) return 0;
    
    for (int i = 0; i < count; i++) {
        double tr = rates[i].high - rates[i].low;
        tr = MathMax(tr, MathAbs(rates[i].high - rates[i + 1].close));
        tr = MathMax(tr, MathAbs(rates[i].low - rates[i + 1].close));
        sum += tr;
    }
    
    return sum / count;
}

//+------------------------------------------------------------------+
// DETECT TIME TO SPIKE
//+------------------------------------------------------------------+
int DetectTimeToSpike(MqlRates &rates[]) {
    double volatility = CalculateVolatility(rates);
    
    if (volatility > 5.0) return 1;
    if (volatility > 3.0) return 3;
    if (volatility > 1.5) return 5;
    
    return 10;
}

//+------------------------------------------------------------------+
// CALCULATE PRICE TARGET
//+------------------------------------------------------------------+
double CalculatePriceTarget(MqlRates &rates[], SIGNAL_TYPE signal) {
    double atr = CalculateATR(rates);
    double current = rates[0].close;
    double point = SymbolInfoDouble(BrokerSymbol, SYMBOL_POINT);
    
    if (signal == SIGNAL_BUY) {
        return current + (atr * TakeProfitPips / 100);
    } else if (signal == SIGNAL_SELL) {
        return current - (atr * TakeProfitPips / 100);
    }
    
    return current;
}

//+------------------------------------------------------------------+
// EXECUTE TRADE LOGIC
//+------------------------------------------------------------------+
void ExecuteTradeLogic() {
    if (!EnableAutoTrading) return;
    if (current_prediction.confidence < 0.65) return;
    
    int current_bar = (int)(TimeCurrent() / 60);
    if (current_bar == last_signal_bar) return;
    
    int open_trades = CountOpenTrades();
    
    if (OpenAllPositionsAtOnce && open_trades == 0 && !all_positions_opened) {
        if (current_prediction.signal == SIGNAL_BUY && current_prediction.confidence > 0.75) {
            for (int i = 0; i < MaxOpenTrades; i++) {
                ExecuteBuyOrder(FixedLotSize);
                Sleep(50);
            }
            all_positions_opened = true;
            last_signal_bar = current_bar;
        }
        else if (current_prediction.signal == SIGNAL_SELL && current_prediction.confidence > 0.75) {
            for (int i = 0; i < MaxOpenTrades; i++) {
                ExecuteSellOrder(FixedLotSize);
                Sleep(50);
            }
            all_positions_opened = true;
            last_signal_bar = current_bar;
        }
    }
    else if (!OpenAllPositionsAtOnce && open_trades < MaxOpenTrades) {
        if (current_prediction.signal == SIGNAL_BUY && current_prediction.confidence > 0.75) {
            ExecuteBuyOrder(FixedLotSize);
            last_signal_bar = current_bar;
        }
        else if (current_prediction.signal == SIGNAL_SELL && current_prediction.confidence > 0.75) {
            ExecuteSellOrder(FixedLotSize);
            last_signal_bar = current_bar;
        }
    }
    
    if (current_prediction.signal == SIGNAL_EXIT) {
        all_positions_opened = false;
    }
}

//+------------------------------------------------------------------+
// EXECUTE BUY ORDER
//+------------------------------------------------------------------+
bool ExecuteBuyOrder(double volume) {
    double ask = SymbolInfoDouble(BrokerSymbol, SYMBOL_ASK);
    double point = SymbolInfoDouble(BrokerSymbol, SYMBOL_POINT);
    double sl = ask - (StopLossPips * point);
    double tp = ask + (TakeProfitPips * point);
    
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    
    request.action = TRADE_ACTION_DEAL;
    request.symbol = BrokerSymbol;
    request.volume = volume;
    request.price = ask;
    request.sl = sl;
    request.tp = tp;
    request.type = ORDER_TYPE_BUY;
    request.type_filling = GetOrderFilling();
    request.magic = GetMagicNumber();
    request.comment = "AI-BoomCrash-BUY";
    
    if (!OrderSend(request, result)) {
        Print("Buy order failed: Error=", GetLastError(), " Retcode=", result.retcode);
        return false;
    }
    
    AddTradeToHistory(result.order, SIGNAL_BUY, ask);
    Print("✓ Buy order: Ticket=", result.order, " Volume=", volume, " Price=", ask);
    return true;
}

//+------------------------------------------------------------------+
// EXECUTE SELL ORDER
//+------------------------------------------------------------------+
bool ExecuteSellOrder(double volume) {
    double bid = SymbolInfoDouble(BrokerSymbol, SYMBOL_BID);
    double point = SymbolInfoDouble(BrokerSymbol, SYMBOL_POINT);
    double sl = bid + (StopLossPips * point);
    double tp = bid - (TakeProfitPips * point);
    
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    
    request.action = TRADE_ACTION_DEAL;
    request.symbol = BrokerSymbol;
    request.volume = volume;
    request.price = bid;
    request.sl = sl;
    request.tp = tp;
    request.type = ORDER_TYPE_SELL;
    request.type_filling = GetOrderFilling();
    request.magic = GetMagicNumber();
    request.comment = "AI-BoomCrash-SELL";
    
    if (!OrderSend(request, result)) {
        Print("Sell order failed: Error=", GetLastError(), " Retcode=", result.retcode);
        return false;
    }
    
    AddTradeToHistory(result.order, SIGNAL_SELL, bid);
    Print("✓ Sell order: Ticket=", result.order, " Volume=", volume, " Price=", bid);
    return true;
}

//+------------------------------------------------------------------+
// GET ORDER FILLING TYPE
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING GetOrderFilling() {
    long filling_mode = SymbolInfoInteger(BrokerSymbol, SYMBOL_FILLING_MODE);
    
    if ((filling_mode & SYMBOL_FILLING_FOK) != 0) {
        return ORDER_FILLING_FOK;
    }
    if ((filling_mode & SYMBOL_FILLING_IOC) != 0) {
        return ORDER_FILLING_IOC;
    }
    
    return ORDER_FILLING_RETURN;
}

//+------------------------------------------------------------------+
// MANAGE ACTIVE TRADES
//+------------------------------------------------------------------+
void ManageActiveTrades() {
    for (int i = PositionsTotal() - 1; i >= 0; i--) {
        CPositionInfo pos;
        if (!pos.SelectByIndex(i)) continue;
        
        if (pos.Symbol() != BrokerSymbol || pos.Magic() != GetMagicNumber()) continue;
        
        ulong ticket = pos.Ticket();
        double current_price = (pos.PositionType() == POSITION_TYPE_BUY) ? 
                               SymbolInfoDouble(BrokerSymbol, SYMBOL_BID) : 
                               SymbolInfoDouble(BrokerSymbol, SYMBOL_ASK);
        
        double point = SymbolInfoDouble(BrokerSymbol, SYMBOL_POINT);
        double position_profit = (pos.PositionType() == POSITION_TYPE_BUY) ? 
                                (current_price - pos.PriceOpen()) : 
                                (pos.PriceOpen() - current_price);
        
        // Exit signal
        if (current_prediction.signal == SIGNAL_EXIT) {
            ClosePosition(ticket);
            all_positions_opened = false;
            continue;
        }
        
        // Take profit
        if (UseAutoTakeProfit && position_profit >= (TakeProfitPips * point)) {
            ClosePosition(ticket);
            continue;
        }
        
        // Stop loss
        if (UseAutoStopLoss && position_profit <= -(StopLossPips * point)) {
            ClosePosition(ticket);
            continue;
        }
    }
}

//+------------------------------------------------------------------+
// CLOSE POSITION
//+------------------------------------------------------------------+
bool ClosePosition(ulong ticket) {
    CPositionInfo position;
    
    if (!position.SelectByTicket(ticket)) {
        return false;
    }
    
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    
    request.action = TRADE_ACTION_DEAL;
    request.symbol = BrokerSymbol;
    request.volume = position.Volume();
    request.type = (position.PositionType() == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
    request.type_filling = GetOrderFilling();
    request.magic = GetMagicNumber();
    request.comment = "AI-BoomCrash-EXIT";
    
    if (OrderSend(request, result)) {
        Print("✓ Position closed: Ticket=", ticket);
        return true;
    }
    
    Print("Close failed: Error=", GetLastError());
    return false;
}

//+------------------------------------------------------------------+
// DRAW CHART SIGNALS
//+------------------------------------------------------------------+
void DrawChartSignals() {
    MqlRates rates[];
    ArraySetAsSeries(rates, true);
    
    if (CopyRates(BrokerSymbol, PERIOD_M1, 0, 1, rates) <= 0) return;
    
    string signal_name = "AI_Signal_" + TimeToString(TimeCurrent(), TIME_DATE | TIME_MINUTES);
    double point = SymbolInfoDouble(BrokerSymbol, SYMBOL_POINT);
    double signal_price = rates[0].high + 10 * point;
    
    // Clean old signals
    int objects_count = ObjectsTotal(ChartID(), -1, -1);
    if (objects_count > 50) {
        for (int i = 0; i < objects_count - 50; i++) {
            string obj_name = ObjectName(ChartID(), i);
            if (StringFind(obj_name, "AI_Signal") != -1) {
                ObjectDelete(ChartID(), obj_name);
            }
        }
    }
    
    if (current_prediction.signal == SIGNAL_BUY) {
        ObjectCreate(ChartID(), signal_name, OBJ_ARROW, 0, rates[0].time, signal_price);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_ARROWCODE, 108);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_COLOR, Blue);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_WIDTH, 2);
    }
    else if (current_prediction.signal == SIGNAL_SELL) {
        ObjectCreate(ChartID(), signal_name, OBJ_ARROW, 0, rates[0].time, signal_price);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_ARROWCODE, 108);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_COLOR, Red);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_WIDTH, 2);
    }
    else if (current_prediction.signal == SIGNAL_MULTI_SPIKE) {
        ObjectCreate(ChartID(), signal_name, OBJ_ARROW, 0, rates[0].time, signal_price);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_ARROWCODE, 108);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_COLOR, Green);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_WIDTH, 2);
    }
    else if (current_prediction.signal == SIGNAL_EXIT) {
        ObjectCreate(ChartID(), signal_name, OBJ_ARROW, 0, rates[0].time, signal_price);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_ARROWCODE, 108);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_COLOR, White);
        ObjectSetInteger(ChartID(), signal_name, OBJPROP_WIDTH, 2);
    }
    
    ChartRedraw(ChartID());
}

//+------------------------------------------------------------------+
// SEND ALERTS
//+------------------------------------------------------------------+
void SendAlert() {
    string signal_text = "";
    
    switch (current_prediction.signal) {
        case SIGNAL_BUY:
            signal_text = "BUY SIGNAL";
            break;
        case SIGNAL_SELL:
            signal_text = "SELL SIGNAL";
            break;
        case SIGNAL_MULTI_SPIKE:
            signal_text = "MULTI-SPIKE DETECTED";
            break;
        default:
            return;
    }
    
    string alert_message = StringFormat(
        "🤖 AI EA ALERT\n\nSymbol: %s\nSignal: %s\nLot: %.2f\nConfidence: %.2f%%\nSpike: %.2f%%\nTime: %d min\nTP: %d | SL: %d",
        BrokerSymbol,
        signal_text,
        FixedLotSize,
        current_prediction.confidence * 100,
        current_prediction.spike_probability * 100,
        current_prediction.time_to_spike,
        TakeProfitPips,
        StopLossPips
    );
    
    Alert(alert_message);
    Print(alert_message);
}

//+------------------------------------------------------------------+
// HELPER FUNCTIONS
//+------------------------------------------------------------------+
int GetMagicNumber() {
    return 20240001 + (int)IndicesType;
}

int CountOpenTrades() {
    int count = 0;
    for (int i = PositionsTotal() - 1; i >= 0; i--) {
        CPositionInfo pos;
        if (pos.SelectByIndex(i)) {
            if (pos.Symbol() == BrokerSymbol && pos.Magic() == GetMagicNumber()) {
                count++;
            }
        }
    }
    return count;
}

void AddTradeToHistory(ulong ticket, SIGNAL_TYPE signal, double entry_price) {
    if (total_trades >= 100) return;
    
    active_trades[total_trades].ticket = ticket;
    active_trades[total_trades].entry_signal = signal;
    active_trades[total_trades].entry_price = entry_price;
    active_trades[total_trades].entry_time = TimeCurrent();
    active_trades[total_trades].max_profit = 0;
    active_trades[total_trades].max_loss = 0;
    active_trades[total_trades].is_active = true;
    
    total_trades++;
}

void OnDeinit(const int reason) {
    Print("=== EA Deinitialized ===");
    Print("Total Trades: ", total_trades);
}
