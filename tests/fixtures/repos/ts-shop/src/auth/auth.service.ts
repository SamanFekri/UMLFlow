import { Injectable } from '@nestjs/common';
import { UserRepository } from '../users/user.repository';
import { SessionManager } from './session.manager';

@Injectable()
export class AuthService {
  constructor(private readonly users: UserRepository, private readonly sessions: SessionManager) {}

  async login(email: string, password: string): Promise<string> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new Error('not found');
    return this.sessions.create(user.id);
  }
}
