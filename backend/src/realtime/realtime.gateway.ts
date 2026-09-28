import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

/**
 * Empuja en tiempo real (sin polling) lo que el DerivWebsocketService recibe
 * de Deriv. Reutiliza los mismos eventos internos (EventEmitter2) que ya
 * consumen TicksService/CandlesService/AccountService para persistir en
 * Postgres — este gateway solo agrega un segundo consumidor que retransmite
 * por Socket.io a los clientes conectados.
 *
 * Los clientes se autentican con el mismo JWT que usan contra el REST
 * (se manda en el handshake: `io('/realtime', { auth: { token } })`) y se
 * suscriben a símbolos puntuales para no recibir tráfico que no les interesa.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string);

      if (!token) throw new Error('Falta token');

      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>(
          'JWT_SECRET',
          'dev-secret-cambiar-en-produccion',
        ),
      });

      client.data.user = payload;
      this.logger.log(`Cliente conectado: ${payload.email} (${client.id})`);
    } catch {
      this.logger.warn(`Conexión rechazada (token inválido): ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { symbol: string },
  ) {
    if (!body?.symbol) return;
    client.join(`symbol:${body.symbol}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { symbol: string },
  ) {
    if (!body?.symbol) return;
    client.leave(`symbol:${body.symbol}`);
  }

  // Reenvía cada tick únicamente a los clientes suscritos a ese símbolo
  @OnEvent('deriv.tick')
  onTick(tick: any) {
    if (!tick?.symbol) return;
    this.server.to(`symbol:${tick.symbol}`).emit('tick', tick);
  }

  // Reenvía la actualización de la vela en curso al mismo canal por símbolo
  @OnEvent('deriv.candle')
  onCandle(ohlc: any) {
    if (!ohlc?.symbol) return;
    this.server.to(`symbol:${ohlc.symbol}`).emit('candle', ohlc);
  }

  // El balance no es por símbolo: se manda a todos los clientes autenticados
  @OnEvent('deriv.balance')
  onBalance(balance: any) {
    this.server.emit('balance', balance);
  }
}
