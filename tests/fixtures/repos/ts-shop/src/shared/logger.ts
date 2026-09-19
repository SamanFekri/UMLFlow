import { Injectable } from '@nestjs/common';

@Injectable()
export class Logger {
  info(message: string): void {
    console.log(message);
  }
}
