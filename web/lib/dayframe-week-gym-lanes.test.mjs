import test from "node:test";
import assert from "node:assert/strict";
import {placeWeekGymCollisions} from "./dayframe-week-gym-lanes.ts";

test("overlapping timed Gym and calendar blocks are assigned separate lanes",()=>{
  const positions=placeWeekGymCollisions([
    {id:"gym",gym:true,start:1020,end:1110},
    {id:"task",gym:false,start:1050,end:1080},
  ]);
  assert.notEqual(positions.gym.left,positions.task.left);
  assert.equal(positions.gym.width,positions.task.width);
});
test("no layout change when events only touch or Gym is not present",()=>{
  assert.deepEqual(placeWeekGymCollisions([
    {id:"gym",gym:true,start:1020,end:1080},
    {id:"after",gym:false,start:1080,end:1120},
  ]),{});
  assert.deepEqual(placeWeekGymCollisions([
    {id:"a",gym:false,start:1020,end:1080},
    {id:"b",gym:false,start:1030,end:1070},
  ]),{});
});
test("three simultaneous blocks use three lanes and subsequent intervals reuse lanes",()=>{
  const p=placeWeekGymCollisions([
    {id:"gym",gym:true,start:960,end:1080},
    {id:"a",gym:false,start:960,end:1000},
    {id:"b",gym:false,start:980,end:1020},
    {id:"c",gym:false,start:1030,end:1080},
  ]);
  assert.equal(new Set([p.gym.left,p.a.left,p.b.left]).size,3);
  assert.equal(p.b.width,p.c.width);
});
