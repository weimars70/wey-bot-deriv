//+------------------------------------------------------------------+
//|                                       ExportarHistorialHoy.mq5   |
//|                               Copyright 2026, Deriv App Bridge   |
//+------------------------------------------------------------------+
#property copyright "Deriv App Bridge"
#property version   "1.00"
#property script_show_inputs false

void OnStart()
{
   MqlDateTime dt;
   TimeCurrent(dt);
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   datetime startOfDay = StructToTime(dt);
   
   if(!HistorySelect(startOfDay, TimeCurrent()))
   {
      Print("❌ No se pudo seleccionar el historial de hoy.");
      return;
   }
   
   int totalDeals = HistoryDealsTotal();
   string json = "[";
   int count = 0;
   double totalProfitUSD = 0.0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= 0) continue;
      
      long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
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
      totalProfitUSD += netTotalProfit;
      
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
      Print("✅ [Historial Exportado] ", count, " operaciones cerradas exportadas exitosamente a deriv_bridge_history.json. Beneficio total: $", DoubleToString(totalProfitUSD, 2), " USD.");
   }
   else
   {
      Print("❌ Error al abrir deriv_bridge_history.json para escritura.");
   }
}
