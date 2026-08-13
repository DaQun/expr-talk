import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeynmanTurnUserPayload,
  extractFeynmanConcept,
} from "./feynman";

test("extracts the concept name from a Feynman topic card", () => {
  assert.equal(
    extractFeynmanConcept(
      "【费曼学习法】向一个不懂经济学的人解释「通货膨胀」：钱为什么会变得不值钱、常见成因、对日常生活的影响，以及一个容易误解的地方。",
    ),
    "通货膨胀",
  );
  assert.equal(extractFeynmanConcept("复利"), "复利");
  assert.equal(
    extractFeynmanConcept("【费曼学习法】向初学者解释数据库索引"),
    "向初学者解释数据库索引",
  );
});

test("does not treat the topic card as something the user already said", () => {
  const payload = buildFeynmanTurnUserPayload(
    {
      kind: "feynman",
      phase: "cross_examination",
      currentRound: 5,
      turns: [
        {
          id: "u5",
          role: "user",
          round: 5,
          text: "冷饮和吃面都变贵了。",
          createdAt: "now",
        },
      ],
    },
    "【费曼学习法】向一个不懂经济学的人解释「通货膨胀」：钱为什么会变得不值钱、常见成因、对日常生活的影响，以及一个容易误解的地方。",
  );
  assert.equal(payload.concept, "通货膨胀");
  assert.equal(
    payload.topicBrief,
    "【费曼学习法】向一个不懂经济学的人解释「通货膨胀」：钱为什么会变得不值钱、常见成因、对日常生活的影响，以及一个容易误解的地方。",
  );
  assert.deepEqual(payload.explanations, [
    { speaker: "user", round: 5, text: "冷饮和吃面都变贵了。" },
  ]);
});
