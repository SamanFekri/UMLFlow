import { Injectable } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { PaymentService } from '../payments/payment.service';
import { InventoryService } from '../inventory/inventory.service';
import { Logger } from '../shared/logger';
import { CreateOrderDto } from './dto';
import { Order } from './order.entity';

@Injectable()
export class OrderService {
  constructor(
    private readonly repo: OrderRepository,
    private readonly payments: PaymentService,
    private readonly inventory: InventoryService,
    private readonly logger: Logger,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    this.logger.info('creating order');
    const order = new Order();
    order.total = dto.total;
    this.validate(order);
    await this.inventory.reserve(dto.items);
    await this.payments.charge(order);
    order.status = 'confirmed';
    return this.repo.save(order);
  }

  async findOrder(id: string): Promise<Order | null> {
    return this.repo.findById(id);
  }

  private validate(order: Order): void {
    if (order.total < 0) throw new Error('invalid');
  }
}
