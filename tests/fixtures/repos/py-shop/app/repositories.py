from .models import Order


class OrderRepository:
    def __init__(self, session):
        self.session = session

    def save(self, order: Order):
        self.session.add(order)
        self.session.commit()
        return order
