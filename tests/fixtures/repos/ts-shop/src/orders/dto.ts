export interface CreateOrderDto {
  total: number;
  items: { sku: string; quantity: number }[];
}
