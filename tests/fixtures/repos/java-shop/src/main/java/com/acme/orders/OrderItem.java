package com.acme.orders;

import jakarta.persistence.*;

@Entity
@Table(name = "order_items")
public class OrderItem {
    @Id private Long id;
    private String sku;
    @ManyToOne private Order order;
}
