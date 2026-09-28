#property copyright "Deriv App"
#property version   "1.00"
#property strict
#property script_show_inputs
#property description "Exporta a CSV los niveles con reacciones repetidas en indices Boom y Crash."

input int             DiasAnalisis        = 365;
input ENUM_TIMEFRAMES TimeframeAnalisis   = PERIOD_M5;
input int             DistanciaMaximaPuntos = 100;
input int             MinimoReacciones    = 2;
input int             VelasConfirmacion   = 3;
input int             ReboteMinimoPuntos  = 300;
input string          NombreArchivo       = "reacciones_boom_crash_365.csv";

struct ZonaReaccion
{
   string   simbolo;
   string   tipo;
   double   nivel;
   double   desde;
   double   hasta;
   int      cantidad;
   datetime primera;
   datetime ultima;
   double   precio_minimo;
   double   precio_maximo;
   double   rebote_maximo_puntos;
   int      digitos;
};

ZonaReaccion zonas[];
string simbolos[];

string MinusculasAscii(string texto)
{
   string resultado = "";

   for(int i = 0; i < StringLen(texto); i++)
   {
      ushort caracter = StringGetCharacter(texto, i);
      if(caracter >= 65 && caracter <= 90)
         caracter = (ushort)(caracter + 32);

      resultado += ShortToString(caracter);
   }

   return resultado;
}

bool EsIndiceBoomCrash(string simbolo)
{
   string nombre = MinusculasAscii(simbolo);
   return StringFind(nombre, "boom") >= 0 || StringFind(nombre, "crash") >= 0;
}

bool SimboloYaAgregado(string simbolo)
{
   for(int i = 0; i < ArraySize(simbolos); i++)
   {
      if(simbolos[i] == simbolo)
         return true;
   }

   return false;
}

void AgregarSimbolo(string simbolo)
{
   if(simbolo == "" || SimboloYaAgregado(simbolo))
      return;

   int total = ArraySize(simbolos);
   ArrayResize(simbolos, total + 1);
   simbolos[total] = simbolo;
}

void BuscarSimbolos(bool solo_market_watch)
{
   int total = SymbolsTotal(solo_market_watch);

   for(int i = 0; i < total; i++)
   {
      string simbolo = SymbolName(i, solo_market_watch);
      if(EsIndiceBoomCrash(simbolo))
         AgregarSimbolo(simbolo);
   }
}

void CargarSimbolos()
{
   ArrayResize(simbolos, 0);

   // Revisa todos los simbolos ofrecidos por el broker, esten visibles o no.
   BuscarSimbolos(false);
}

void OrdenarVelasDeAntiguaANueva(MqlRates &velas[])
{
   int total = ArraySize(velas);
   if(total < 2 || velas[0].time <= velas[total - 1].time)
      return;

   for(int i = 0; i < total / 2; i++)
   {
      MqlRates temporal = velas[i];
      velas[i] = velas[total - 1 - i];
      velas[total - 1 - i] = temporal;
   }
}

int BuscarZona(string simbolo, string tipo, double precio, double punto)
{
   double distancia_maxima = DistanciaMaximaPuntos * punto;
   if(distancia_maxima <= 0.0)
      distancia_maxima = punto;

   int mejor_posicion = -1;
   double mejor_distancia = DBL_MAX;

   for(int i = 0; i < ArraySize(zonas); i++)
   {
      if(zonas[i].simbolo != simbolo || zonas[i].tipo != tipo)
         continue;

      double nuevo_minimo = MathMin(zonas[i].precio_minimo, precio);
      double nuevo_maximo = MathMax(zonas[i].precio_maximo, precio);

      // Todas las reacciones de la zona deben caber dentro de la distancia maxima.
      if(nuevo_maximo - nuevo_minimo > distancia_maxima)
         continue;

      double distancia = MathAbs(zonas[i].nivel - precio);
      if(distancia < mejor_distancia)
      {
         mejor_distancia = distancia;
         mejor_posicion = i;
      }
   }

   return mejor_posicion;
}

void RegistrarReaccion(string simbolo,
                       string tipo,
                       double precio,
                       datetime fecha,
                       double rebote_puntos,
                       double punto,
                       int digitos)
{
   int posicion = BuscarZona(simbolo, tipo, precio, punto);

   if(posicion < 0)
   {
      posicion = ArraySize(zonas);
      ArrayResize(zonas, posicion + 1);

      zonas[posicion].simbolo = simbolo;
      zonas[posicion].tipo = tipo;
      zonas[posicion].nivel = NormalizeDouble(precio, digitos);
      zonas[posicion].desde = NormalizeDouble(precio, digitos);
      zonas[posicion].hasta = NormalizeDouble(precio, digitos);
      zonas[posicion].cantidad = 1;
      zonas[posicion].primera = fecha;
      zonas[posicion].ultima = fecha;
      zonas[posicion].precio_minimo = precio;
      zonas[posicion].precio_maximo = precio;
      zonas[posicion].rebote_maximo_puntos = rebote_puntos;
      zonas[posicion].digitos = digitos;
      return;
   }

   zonas[posicion].cantidad++;

   if(fecha < zonas[posicion].primera)
      zonas[posicion].primera = fecha;
   if(fecha > zonas[posicion].ultima)
      zonas[posicion].ultima = fecha;
   if(precio < zonas[posicion].precio_minimo)
      zonas[posicion].precio_minimo = precio;
   if(precio > zonas[posicion].precio_maximo)
      zonas[posicion].precio_maximo = precio;
   if(rebote_puntos > zonas[posicion].rebote_maximo_puntos)
      zonas[posicion].rebote_maximo_puntos = rebote_puntos;

   zonas[posicion].desde = NormalizeDouble(zonas[posicion].precio_minimo, digitos);
   zonas[posicion].hasta = NormalizeDouble(zonas[posicion].precio_maximo, digitos);
   zonas[posicion].nivel = NormalizeDouble(
      (zonas[posicion].precio_minimo + zonas[posicion].precio_maximo) / 2.0,
      digitos);
}

bool EsReaccionAlcista(MqlRates &velas[], int indice, int total, double punto, double &rebote_puntos)
{
   rebote_puntos = 0.0;

   bool minimo_local =
      velas[indice].low <= velas[indice - 1].low &&
      velas[indice].low <  velas[indice - 2].low &&
      velas[indice].low <= velas[indice + 1].low &&
      velas[indice].low <  velas[indice + 2].low;

   if(!minimo_local)
      return false;

   int confirmaciones = VelasConfirmacion;
   if(confirmaciones < 1)
      confirmaciones = 1;

   double maximo_posterior = velas[indice].high;
   for(int i = 1; i <= confirmaciones && indice + i < total; i++)
   {
      if(velas[indice + i].high > maximo_posterior)
         maximo_posterior = velas[indice + i].high;
   }

   rebote_puntos = (maximo_posterior - velas[indice].low) / punto;
   return rebote_puntos >= ReboteMinimoPuntos;
}

bool EsReaccionBajista(MqlRates &velas[], int indice, int total, double punto, double &rebote_puntos)
{
   rebote_puntos = 0.0;

   bool maximo_local =
      velas[indice].high >= velas[indice - 1].high &&
      velas[indice].high >  velas[indice - 2].high &&
      velas[indice].high >= velas[indice + 1].high &&
      velas[indice].high >  velas[indice + 2].high;

   if(!maximo_local)
      return false;

   int confirmaciones = VelasConfirmacion;
   if(confirmaciones < 1)
      confirmaciones = 1;

   double minimo_posterior = velas[indice].low;
   for(int i = 1; i <= confirmaciones && indice + i < total; i++)
   {
      if(velas[indice + i].low < minimo_posterior)
         minimo_posterior = velas[indice + i].low;
   }

   rebote_puntos = (velas[indice].high - minimo_posterior) / punto;
   return rebote_puntos >= ReboteMinimoPuntos;
}

int AnalizarSimbolo(string simbolo)
{
   ResetLastError();
   if(!SymbolSelect(simbolo, true))
   {
      Print("No se pudo seleccionar ", simbolo, ". Error: ", GetLastError());
      return 0;
   }

   double punto = SymbolInfoDouble(simbolo, SYMBOL_POINT);
   int digitos = (int)SymbolInfoInteger(simbolo, SYMBOL_DIGITS);

   if(punto <= 0.0)
   {
      Print("El simbolo ", simbolo, " no tiene un valor de punto valido.");
      return 0;
   }

   datetime fecha_final = TimeCurrent();
   datetime fecha_inicial = fecha_final - (datetime)((long)DiasAnalisis * 86400);
   MqlRates velas[];

   ResetLastError();
   int copiadas = CopyRates(simbolo, TimeframeAnalisis, fecha_inicial, fecha_final, velas);
   if(copiadas < 10)
   {
      Print("No hay historial suficiente para ", simbolo,
            ". Velas copiadas: ", copiadas, ". Error: ", GetLastError());
      return 0;
   }

   OrdenarVelasDeAntiguaANueva(velas);

   int confirmaciones = VelasConfirmacion;
   if(confirmaciones < 2)
      confirmaciones = 2;

   int ultimo_indice = copiadas - 1 - confirmaciones;
   int encontradas = 0;

   for(int i = 2; i <= ultimo_indice; i++)
   {
      double rebote_alcista = 0.0;
      double rebote_bajista = 0.0;

      if(EsReaccionAlcista(velas, i, copiadas, punto, rebote_alcista))
      {
         RegistrarReaccion(simbolo, "ALCISTA", velas[i].low, velas[i].time,
                           rebote_alcista, punto, digitos);
         encontradas++;
      }

      if(EsReaccionBajista(velas, i, copiadas, punto, rebote_bajista))
      {
         RegistrarReaccion(simbolo, "BAJISTA", velas[i].high, velas[i].time,
                           rebote_bajista, punto, digitos);
         encontradas++;
      }
   }

   Print(simbolo, ": ", copiadas, " velas revisadas y ", encontradas, " reacciones detectadas.");
   return encontradas;
}

string TextoTimeframe()
{
   switch(TimeframeAnalisis)
   {
      case PERIOD_M1:  return "M1";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
      case PERIOD_D1:  return "D1";
      case PERIOD_W1:  return "W1";
      case PERIOD_MN1: return "MN1";
   }

   return EnumToString(TimeframeAnalisis);
}

int ExportarCsv()
{
   ResetLastError();
   int archivo = FileOpen(NombreArchivo,
                          FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE,
                          ';');

   if(archivo == INVALID_HANDLE)
   {
      Print("No se pudo crear ", NombreArchivo, ". Error: ", GetLastError());
      return -1;
   }

   FileWrite(archivo,
             "indice",
             "tipo_reaccion",
             "nivel_central",
             "zona_desde",
             "zona_hasta",
             "ancho_zona_puntos",
             "numero_reacciones",
             "primera_reaccion",
             "ultima_reaccion",
             "precio_minimo_detectado",
             "precio_maximo_detectado",
             "rebote_maximo_puntos",
             "timeframe",
             "dias_analizados",
             "distancia_maxima_puntos",
             "rebote_minimo_puntos");

   int filas = 0;
   string timeframe = TextoTimeframe();

   for(int i = 0; i < ArraySize(zonas); i++)
   {
      if(zonas[i].cantidad < MinimoReacciones)
         continue;

      double punto = SymbolInfoDouble(zonas[i].simbolo, SYMBOL_POINT);
      double ancho_zona_puntos = 0.0;
      if(punto > 0.0)
         ancho_zona_puntos = (zonas[i].hasta - zonas[i].desde) / punto;

      FileWrite(archivo,
                zonas[i].simbolo,
                zonas[i].tipo,
                DoubleToString(zonas[i].nivel, zonas[i].digitos),
                DoubleToString(zonas[i].desde, zonas[i].digitos),
                DoubleToString(zonas[i].hasta, zonas[i].digitos),
                DoubleToString(ancho_zona_puntos, 1),
                zonas[i].cantidad,
                TimeToString(zonas[i].primera, TIME_DATE | TIME_MINUTES),
                TimeToString(zonas[i].ultima, TIME_DATE | TIME_MINUTES),
                DoubleToString(zonas[i].precio_minimo, zonas[i].digitos),
                DoubleToString(zonas[i].precio_maximo, zonas[i].digitos),
                DoubleToString(zonas[i].rebote_maximo_puntos, 1),
                timeframe,
                DiasAnalisis,
                DistanciaMaximaPuntos,
                ReboteMinimoPuntos);

      filas++;
   }

   FileClose(archivo);
   return filas;
}

void OnStart()
{
   ArrayResize(zonas, 0);
   CargarSimbolos();

   if(ArraySize(simbolos) == 0)
   {
      Print("No se encontraron indices Boom o Crash en la cuenta del broker.");
      return;
   }

   Print("Analizando ", ArraySize(simbolos), " indices Boom/Crash durante ", DiasAnalisis, " dias...");

   int total_reacciones = 0;
   for(int i = 0; i < ArraySize(simbolos); i++)
      total_reacciones += AnalizarSimbolo(simbolos[i]);

   int filas = ExportarCsv();
   if(filas < 0)
      return;

   Print("Proceso terminado. Reacciones detectadas: ", total_reacciones,
         ". Zonas repetidas exportadas: ", filas,
         ". Archivo: MQL5/Files/", NombreArchivo);
}
