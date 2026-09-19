from fastapi import APIRouter, Depends
from .services import OrderService

router = APIRouter()


@router.post("/orders")
async def create_order(dto, service: OrderService = Depends()):
    return service.create_order(dto)


@router.get("/orders/{order_id}")
def get_order(order_id: int, service: OrderService = Depends()):
    return service.repo.session.get(order_id)
