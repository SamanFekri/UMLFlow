import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto';

@Controller('/orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post('/')
  async create(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Get('/:id')
  async get(@Param('id') id: string) {
    return this.orders.findOrder(id);
  }
}
