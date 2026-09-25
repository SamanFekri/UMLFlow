import { OrderService } from './order.service.js';
import { NotificationService } from './notification.service.js';

// Composition root: dependencies are hand-wired, with no DI container.
const orders = new OrderService();
const notifications = new NotificationService();

export function wire(app: any, bus: any, queue: any, scheduler: any, bot: any) {
  // HTTP entry point with an inline handler.
  app.post('/orders', async (req: any, reply: any) => {
    const order = await orders.placeOrder(req.body);
    bus.emit('order.placed', order);
    return reply.send(order);
  });

  // Event-driven entry point.
  bus.on('order.placed', async (order: any) => {
    await notifications.notifyCustomer(order);
  });

  // Queue consumer.
  queue.process('settle-orders', async (job: any) => {
    await orders.settle(job.data);
  });

  // Scheduled job.
  scheduler.schedule('0 2 * * *', async () => {
    await orders.expireStale();
  });

  // Chat/CLI command.
  bot.command('status', async (ctx: any) => {
    await notifications.reportStatus(ctx);
  });
}
