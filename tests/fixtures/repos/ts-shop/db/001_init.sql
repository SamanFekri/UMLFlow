-- Initial schema
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id),
  total NUMERIC(10, 2) NOT NULL,
  status VARCHAR(32) DEFAULT 'pending'
);

CREATE TABLE order_items (
  id SERIAL,
  order_id UUID NOT NULL,
  sku VARCHAR(64) NOT NULL,
  quantity INT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID,
  message TEXT
);
ALTER TABLE audit_log ADD CONSTRAINT fk_actor FOREIGN KEY (actor_id) REFERENCES users(id);
