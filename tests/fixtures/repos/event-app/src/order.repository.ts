export class OrderRepository {
  async save(data: any) { return data; }
  async markSettled(id: string) { return id; }
  async deleteExpired() { return 0; }
}
