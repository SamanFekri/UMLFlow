import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentGateway {
  async authorize(amount: number): Promise<boolean> {
    return amount > 0;
  }
  async capture(amount: number): Promise<void> {}
}
