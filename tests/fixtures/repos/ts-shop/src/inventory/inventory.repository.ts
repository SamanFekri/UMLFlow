import { Injectable } from '@nestjs/common';

@Injectable()
export class InventoryRepository {
  async decrement(sku: string, quantity: number): Promise<void> {}
}
