import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Order } from './order.entity';

@Injectable()
export class OrderRepository {
  constructor(private readonly repo: Repository<Order>) {}

  async save(order: Order): Promise<Order> {
    return this.repo.save(order);
  }

  async findById(id: string): Promise<Order | null> {
    return this.repo.findOne({ where: { id } });
  }
}
