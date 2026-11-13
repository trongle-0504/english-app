# Sample data to try Writing Mock Test — Task 1

For question **bar-001** (the first one in the list: *"The bar chart illustrates the amount of money a company donated to
six charitable organizations…"*). The figures in the picture are made up for testing; they are not the real exam chart.
The unit-test fixtures in `mocks/llm/` are written for exactly these texts.

## 1. Chart picture

`bar-001-chart.png` (same folder). Open it → right click → **Copy image** → on the "Chuẩn bị đề" screen press **Ctrl+V**.
Or drag the file onto the drop zone, or use **Chọn file ảnh**.

## 2. Model essay (paste into "Bài mẫu của bạn")

The bar chart illustrates how much money a company donated to six charities between 2012 and 2014.

Overall, social welfare received by far the largest share of the donations in every year, whereas the arts consistently received the least. While contributions to most causes rose over the period, those to wildlife and the arts declined slightly by the end.

In 2012, social welfare topped the list at $40,000, followed by health and education at $30,000 and $25,000 respectively. Far smaller sums went to the environment ($15,000), wildlife ($10,000) and the arts ($5,000).

Over the next two years, donations to social welfare climbed steadily to reach $50,000 in 2014. Health and education saw more modest growth, to $35,000 and $30,000. The most striking change was in environmental causes, whose funding rose by almost half to $22,000. By contrast, after a small increase in 2013, the amounts given to wildlife and the arts dipped to $9,000 and $4,000.

## 3. Vietnamese plan (step 1, 5 minutes)

Mở bài: biểu đồ cột, số tiền công ty quyên góp cho 6 tổ chức từ thiện, 2012–2014.
Overview: phúc lợi xã hội luôn nhiều nhất, nghệ thuật luôn ít nhất; phần lớn tăng, riêng động vật hoang dã và nghệ thuật giảm nhẹ cuối kỳ.
Thân bài 1: năm 2012 — phúc lợi 40, y tế 30, giáo dục 25, môi trường 15, động vật 10, nghệ thuật 5 (nghìn đô).
Thân bài 2: tới 2014 — phúc lợi lên 50, y tế 35, giáo dục 30, môi trường tăng mạnh nhất lên 22; động vật và nghệ thuật giảm còn 9 và 4.

## 4. Answer (step 2, 20 minutes) — with planted mistakes

The bar chart illustrate how much money a company donated to six charity organisations from 2012 to 2014. Overall, social welfare received the most money in every year, while the arts received the least. In addition, donations to most charities increased over the period, but wildlife and arts was decreased at the end.

In 2012, the company gave about 40 thousand dollars to social welfare, which was followed by health with 30 thousand dollars. Education got around 25 thousand dollars, while environment, wildlife and the arts received much more smaller amounts, at 15, 10 and 5 thousand dollars respectively.

By 2014, the figure for social welfare had raised to 50 thousand dollars, and donations to health and education also grew to 35 and 30 thousand dollars. Environment saw the biggest increase, reaching 22 thousand dollars. In contrast, the amounts gave to wildlife and the arts fell slightly to 9 and 4 thousand dollars.

## Notes

- Keep each paragraph on **one line** (as here): Writing Review treats every line break as a new paragraph.
- Planted mistakes in the answer: “illustrate” (agreement), “arts was decreased”, “much more smaller”, “had raised”,
  “amounts gave”, and a data error in sentence 7 (“Environment saw the biggest increase”: social welfare grew most in
  dollars, +10k; environment grew most in percent, about +47%). The Vietnamese plan repeats that error (“môi trường tăng
  mạnh nhất”).
- With the real agent, a good result reads all 18 figures of the chart, flags sentence 7 as a data error, lists the plan
  error under the Vietnamese-plan check, and gives a band around 6.
