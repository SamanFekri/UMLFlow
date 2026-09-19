package com.acme.orders;

import jakarta.persistence.*;

@Entity
public class Customer {
    @Id private Long id;
    @Column(unique = true) private String email;
}
