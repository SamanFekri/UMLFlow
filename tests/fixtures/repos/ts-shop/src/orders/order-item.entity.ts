import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sku: string;

  @Column('int')
  quantity: number;

  @ManyToOne(() => Order, (order) => order.items)
  order: Order;
}
