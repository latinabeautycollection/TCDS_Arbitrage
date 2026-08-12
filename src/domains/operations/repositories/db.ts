import pg from "pg";
import { emailEnv } from "../config/emailEnv";
const { Pool } = pg;
export const pool = new Pool({ connectionString: emailEnv().DATABASE_URL, max: 10, application_name: "tcds-domain10-email" });
