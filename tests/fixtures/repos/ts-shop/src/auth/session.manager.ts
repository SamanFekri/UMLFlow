import { Injectable } from '@nestjs/common';

@Injectable()
export class SessionManager {
  async create(userId: string): Promise<string> {
    return `session-${userId}`;
  }
}
