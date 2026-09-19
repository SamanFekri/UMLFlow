import { Injectable } from '@nestjs/common';
import { InventoryRepository } from './inventory.repository';

@Injectable()
export class InventoryService {
  constructor(private readonly repo: InventoryRepository) {}

  async reserve(items: { sku: string; quantity: number }[]): Promise<void> {
    for (const item of items) {
      await this.repo.decrement(item.sku, item.quantity);
    }
  }
}
