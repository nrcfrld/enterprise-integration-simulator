package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func (s *Server) registerOperationalRoutes(router *gin.Engine) {
	router.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	router.GET("/ready", s.ready)
	router.GET("/metrics", s.metrics.Handler)
	router.GET("/openapi.yaml", func(c *gin.Context) { c.File("openapi/openapi.yaml") })
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler, ginSwagger.URL("/openapi.yaml"), ginSwagger.DocExpansion("list")))
}

func (s *Server) registerControlRoutes(router *gin.Engine) {
	control := router.Group("/control/v1")
	control.POST("/auth/login", s.login)
	control.POST("/auth/register", s.register)

	secured := control.Group("")
	secured.Use(s.controlAuth)
	secured.GET("/dashboard", s.dashboard)
	secured.GET("/shops", s.listShops)
	secured.POST("/shops", s.createShop)
	// Reset is scoped by mustAccessShop inside the handler: administrators may
	// reset any shop, while operators may reset only a shop they own.
	secured.POST("/shops/:id/reset", s.resetShop)
	secured.GET("/shops/:id/events", s.shopEvents)
	secured.GET("/shops/:id/products", s.shopProducts)
	secured.POST("/shops/:id/products", s.createControlProduct)
	secured.GET("/shops/:id/products/:productID", s.getControlProduct)
	secured.PATCH("/shops/:id/products/:productID", s.updateControlProduct)
	secured.DELETE("/shops/:id/products/:productID", s.archiveControlProduct)
	secured.GET("/shops/:id/warehouses", s.shopWarehouses)
	secured.POST("/shops/:id/warehouses", s.createControlWarehouse)
	secured.GET("/shops/:id/orders", s.shopOrders)
	secured.POST("/shops/:id/orders", s.createSimulatedOrder)
	secured.GET("/shops/:id/shipments", s.shopShipments)
	secured.GET("/shops/:id/packages", s.shopPackages)
	secured.POST("/shops/:id/packages", s.createControlPackage)
	secured.GET("/orders/:id", s.orderDetail)
	secured.POST("/orders/:id/actions/:action", s.orderAction)
	secured.GET("/shipments/:id", s.shipmentDetail)
	secured.GET("/packages/:id", s.packageDetail)
	secured.GET("/warehouses/:id", s.warehouseDetail)
	secured.PATCH("/warehouses/:id", s.updateControlWarehouse)
	secured.PUT("/warehouses/:id/inventory/:productID", s.updateWarehouseInventory)
	secured.POST("/shipments/:id/actions/:action", s.shipmentAction)
	secured.POST("/shops/:id/credentials", s.createCredential)
	secured.GET("/shops/:id/credentials", s.listCredentials)
	secured.POST("/credentials/:id/revoke", s.revokeCredential)
	secured.GET("/shops/:id/webhooks", s.controlWebhooks)
	secured.POST("/shops/:id/webhooks", s.createControlWebhook)
	secured.PATCH("/shops/:id/webhooks/:webhookID", s.updateControlWebhook)
	secured.DELETE("/shops/:id/webhooks/:webhookID", s.deleteControlWebhook)
	secured.GET("/shops/:id/deliveries", s.controlDeliveries)
	secured.GET("/deliveries/:id", s.deliveryDetail)
	secured.POST("/deliveries/:id/retry", s.retryDelivery)
	secured.POST("/events/:id/replay", s.replayEvent)
	secured.POST("/events/:id/duplicate", s.duplicateEvent)
	secured.POST("/events/:id/delay", s.delayEvent)
	secured.GET("/shops/:id/scenario", s.getScenario)
	secured.PUT("/shops/:id/scenario", s.putScenario)
	secured.GET("/maintenance", s.getMaintenance)
	secured.PUT("/maintenance", s.requireRole("ADMIN"), s.maintenance)
	secured.GET("/users", s.requireRole("ADMIN"), s.listUsers)
	secured.POST("/users", s.requireRole("ADMIN"), s.createUser)
}

func (s *Server) registerSharedRoutes(router *gin.Engine) {
	api := router.Group("/api/v1")
	api.Use(s.integrationAuth, s.applyScenario)
	api.POST("/webhooks", s.idempotent("webhooks.create"), s.createWebhook)
	api.GET("/webhooks", s.listWebhooks)
	api.DELETE("/webhooks/:id", s.idempotent("webhooks.delete"), s.deleteWebhook)
	api.GET("/warehouses", s.listWarehouses)
	api.GET("/warehouses/:id", s.getWarehouse)
}

func (s *Server) registerShopeeRoutes(router *gin.Engine) {
	// Provider-owned HTTP contracts share canonical persistence, but keep their
	// versioning, authentication, errors, and projections within this boundary.
	shopee := router.Group("/api/shopee/v1")
	shopee.Use(s.shopeeIntegrationAuth, s.applyScenario)
	shopee.GET("/products", s.shopeeListProducts)
	shopee.GET("/products/:id", s.shopeeGetProduct)
	shopee.GET("/orders", s.shopeeListOrders)
	shopee.GET("/orders/:id", s.shopeeGetOrder)
	shopee.POST("/orders/:id/cancel", s.idempotent("shopee.orders.cancel"), s.shopeeCancelOrder)
	shopee.POST("/orders/:id/ship-order", s.idempotent("shopee.orders.process"), s.shopeeProcessOrder)
	shopee.POST("/orders/:id/ready-to-ship", s.idempotent("shopee.orders.ready_to_ship"), s.shopeeReadyToShipOrder)
	shopee.POST("/orders/:id/packages", s.idempotent("shopee.packages.create"), s.shopeeCreatePackage)
	shopee.POST("/orders/:id/shipments", s.idempotent("shopee.shipments.create"), s.shopeeCreateShipment)
	shopee.POST("/webhooks", s.idempotent("shopee.webhooks.create"), s.shopeeCreateWebhook)
	shopee.GET("/webhooks", s.shopeeListWebhooks)
}

func (s *Server) registerTokopediaRoutes(router *gin.Engine) {
	tokopediaAPI := router.Group("/api/tokopedia/v202309")
	tokopediaAPI.Use(s.tokopediaIntegrationAuth, s.applyScenario)
	tokopediaAPI.POST("/products/search", s.tokopediaListProducts)
	tokopediaAPI.GET("/products/:id", s.tokopediaGetProduct)
	tokopediaAPI.POST("/orders/search", s.tokopediaListOrders)
	tokopediaAPI.GET("/orders/:id", s.tokopediaGetOrder)
	tokopediaAPI.POST("/orders/:id/pack", s.idempotent("tokopedia.orders.pack"), s.tokopediaPackOrder)
	tokopediaAPI.POST("/orders/:id/handover", s.idempotent("tokopedia.orders.handover"), s.tokopediaHandoverOrder)
	tokopediaAPI.POST("/orders/:id/cancel", s.idempotent("tokopedia.orders.cancel"), s.tokopediaCancelOrder)
	tokopediaAPI.POST("/orders/:id/shipments", s.idempotent("tokopedia.shipments.create"), s.tokopediaCreateShipment)
	tokopediaAPI.PUT("/webhooks", s.idempotent("tokopedia.webhooks.configure"), s.tokopediaConfigureWebhooks)
}
