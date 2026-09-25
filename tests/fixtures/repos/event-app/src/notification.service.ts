import { EmailClient } from './email.client.js';
export class NotificationService {
  private email = new EmailClient();
  async notifyCustomer(order: any) { return this.email.send(order.customerEmail); }
  async reportStatus(ctx: any) { return this.email.send('ops@example.com'); }
}
