package payments

type Client struct{}

func (c *Client) Charge(amount float64) error { return nil }
