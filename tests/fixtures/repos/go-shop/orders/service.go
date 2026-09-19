package orders

import "acme/shop/payments"

type Order struct {
	ID    string
	Total float64
}

type OrderRepository struct{}

func (r *OrderRepository) Save(o Order) error { return nil }

type OrderService struct {
	repo     *OrderRepository
	payments *payments.Client
}

func NewOrderService(repo *OrderRepository, p *payments.Client) *OrderService {
	return &OrderService{repo: repo, payments: p}
}

func (s *OrderService) Create(total float64) (Order, error) {
	o := Order{Total: total}
	if err := s.payments.Charge(o.Total); err != nil {
		return o, err
	}
	return o, s.repo.Save(o)
}
