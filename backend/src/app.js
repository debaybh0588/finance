import cors from "cors";
import express from "express";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { tenantContext } from "./middleware/tenantContext.js";
import { authGuard } from "./middleware/authGuard.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(authGuard);
app.use(tenantContext);

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

export default app;
