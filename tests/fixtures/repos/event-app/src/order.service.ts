import { OrderRepository } from './order.repository.js';
import { PaymentGateway } from './payment.gateway.js';

export class OrderService {
  private repo = new OrderRepository();
  private payments = new PaymentGateway();

  async placeOrder(data: any) {
    await this.payments.charge(data.total);
    return this.repo.save(data);
  }
  async settle(data: any) { return this.repo.markSettled(data.id); }
  async expireStale() { return this.repo.deleteExpired(); }
}
