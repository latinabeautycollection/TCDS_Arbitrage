import express from 'express';
const router=express.Router();
router.get('/health',(_req: any, res: any)=>res.json({ok:true,domain:'listing'}));
export default router;
