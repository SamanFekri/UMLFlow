package com.acme.orders;

import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository repository;
    private final PaymentGateway payments;

    public OrderService(OrderRepository repository, PaymentGateway payments) {
        this.repository = repository;
        this.payments = payments;
    }

    public Order create(CreateOrderRequest request) {
        Order order = new Order();
        payments.charge(order.getTotal());
        return repository.save(order);
    }

    public Order find(Long id) {
        return repository.findById(id).orElse(null);
    }
}
