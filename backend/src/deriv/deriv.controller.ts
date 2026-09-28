import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { DerivWebsocketService } from './deriv-websocket.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

@Controller('deriv')
export class DerivController {
  constructor(
    private readonly derivWs: DerivWebsocketService,
    private readonly config: ConfigService,
  ) {}

  // GET /api/deriv/symbols -> lista de símbolos disponibles en Deriv
  // Esta ruta se expone públicamente para poder inspeccionar símbolos válidos
  @Get('symbols')
  async getSymbols() {
    const useOtp = this.config.get<string>('DERIV_USE_OTP', 'false') === 'true';
    if (!useOtp) {
      try {
        const res = await this.derivWs.getActiveSymbols();
        if (res?.active_symbols && res.active_symbols.length > 0) {
          return res.active_symbols;
        }
      } catch (e) {
        // Fallback si falla
      }
    }

    return [
      { symbol: 'CRASH100', display_name: 'Crash 100 Index', market: 'synthetic_index' },
      { symbol: 'CRASH200', display_name: 'Crash 200 Index', market: 'synthetic_index' },
      { symbol: 'CRASH300N', display_name: 'Crash 300 Index', market: 'synthetic_index' },
      { symbol: 'CRASH500', display_name: 'Crash 500 Index', market: 'synthetic_index' },
      { symbol: 'CRASH600', display_name: 'Crash 600 Index', market: 'synthetic_index' },
      { symbol: 'CRASH900', display_name: 'Crash 900 Index', market: 'synthetic_index' },
      { symbol: 'CRASH1000', display_name: 'Crash 1000 Index', market: 'synthetic_index' },
      { symbol: 'BOOM100', display_name: 'Boom 100 Index', market: 'synthetic_index' },
      { symbol: 'BOOM200', display_name: 'Boom 200 Index', market: 'synthetic_index' },
      { symbol: 'BOOM300N', display_name: 'Boom 300 Index', market: 'synthetic_index' },
      { symbol: 'BOOM500', display_name: 'Boom 500 Index', market: 'synthetic_index' },
      { symbol: 'BOOM600', display_name: 'Boom 600 Index', market: 'synthetic_index' },
      { symbol: 'BOOM900', display_name: 'Boom 900 Index', market: 'synthetic_index' },
      { symbol: 'BOOM1000', display_name: 'Boom 1000 Index', market: 'synthetic_index' },
      { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index' },
      { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index' },
      { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index' },
      { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index' },
    ];
  }

  // Dev-only: devuelve información enmascarada del token cargado por el backend.
  // No exponer en producción.
  @Get('debug/token')
  getMaskedToken() {
    const env = this.config.get<string>('NODE_ENV', 'development');
    if (env === 'production') return { error: 'Not allowed in production' };
    const token = this.config.get<string>('DERIV_API_TOKEN') || '';
    if (!token) return { loaded: false };
    const first = token.slice(0, 6);
    const last = token.slice(-6);
    return { loaded: true, masked: `${first}...${last}`, length: token.length };
  }

  // POST /api/deriv/subscribe { symbol: 'R_100', granularity: 60 }
  // Permite suscribirse a un símbolo nuevo en caliente desde el frontend.
  // Esta acción requiere autenticación con JWT.
  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(@Body() body: { symbol: string; granularity?: number }) {
    this.derivWs.subscribeTicks(body.symbol);
    this.derivWs.subscribeCandles(body.symbol, body.granularity ?? 60);
    return { subscribed: body.symbol };
  }
}
