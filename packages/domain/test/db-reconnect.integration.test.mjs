import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool} from '../src/db.mjs';

test('idle backend termination does not crash the pool and its next request reconnects',
  {skip:!process.env.TEST_DATABASE_URL,timeout:15000},async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname,/^\/campus_(qa|test)(_[A-Za-z0-9_]+)?$/,'Use a dedicated QA database');
    const manager=createPool(url.href),pool=createPool(url.href);
    let timer;
    try{
      const client=await pool.connect();
      const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      client.release();
      const lost=new Promise((resolve,reject)=>{
        pool.once('error',resolve);
        timer=setTimeout(()=>reject(new Error('Idle connection error was not observed')),5000);
      });
      assert.equal((await manager.query('SELECT pg_terminate_backend($1) terminated',[pid])).rows[0].terminated,true);
      await lost;clearTimeout(timer);
      const next=(await pool.query('SELECT pg_backend_pid() pid,1 value')).rows[0];
      assert.notEqual(next.pid,pid);assert.equal(next.value,1);
    }finally{clearTimeout(timer);await pool.end();await manager.end();}
  });
