import { Injectable } from '@nestjs/common';
import { PaymentGateway } from './payment.gateway';
import { Order } from '../orders/order.entity';

@Injectable()
export class PaymentService {
  constructor(private readonly gateway: PaymentGateway) {}

  async charge(order: Order): Promise<void> {
    const ok = await this.gateway.authorize(order.total);
    if (!ok) throw new Error('declined');
    await this.gateway.capture(order.total);
  }
}
