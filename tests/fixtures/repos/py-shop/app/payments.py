import requests


class PaymentClient:
    def charge(self, amount):
        return requests.post("https://pay.example/charge", json={"amount": amount})
