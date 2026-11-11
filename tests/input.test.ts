import test from "node:test";
import assert from "node:assert/strict";
import { pageNumber, activeLocation, MAX_PAGE_NUMBER } from "../app/utils/input.ts";

test("page numbers reject invalid, nonfinite, fractional and unsafe inputs", () => {
  for (const raw of [null,"","  ","0","-1","1.5","Infinity","NaN","abc","9007199254740993"])
    assert.equal(pageNumber(raw),1, String(raw));
});
test("valid page numbers retain whole values and cap expensive offsets", () => {
  assert.equal(pageNumber("2"),2);
  assert.equal(pageNumber(" 25 "),25);
  assert.equal(pageNumber(String(MAX_PAGE_NUMBER)),MAX_PAGE_NUMBER);
  assert.equal(pageNumber(String(MAX_PAGE_NUMBER+1)),MAX_PAGE_NUMBER);
});
test("saved location is used only while it remains in the active list", () => {
  const locations = [{id:"east"},{id:"west"}];
  assert.equal(activeLocation("west",locations),"west");
  assert.equal(activeLocation("deleted",locations),"east");
  assert.equal(activeLocation("",locations),"east");
  assert.equal(activeLocation("deleted",[]),"");
  assert.deepEqual(locations,[{id:"east"},{id:"west"}]);
});
