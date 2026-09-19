package orders

import "net/http"

type OrderHandler struct {
	service *OrderService
}

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
	h.service.Create(10)
}

func RegisterRoutes(mux *http.ServeMux, h *OrderHandler) {
	mux.HandleFunc("/orders", h.Create)
}
