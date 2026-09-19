from .repositories import OrderRepository
from .payments import PaymentClient
from .models import Order


class OrderService:
    def __init__(self, repo: OrderRepository, payments: PaymentClient):
        self.repo = repo
        self.payments = payments

    def create_order(self, dto):
        order = Order(total=dto.total)
        self.payments.charge(order.total)
        self.repo.save(order)
        return order
