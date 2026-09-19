package com.acme.orders;

import org.springframework.stereotype.Component;

@Component
public class PaymentGateway {
    public void charge(java.math.BigDecimal amount) {}
}
