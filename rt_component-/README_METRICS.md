# Метрики RT: формулы (rt_mvp)

`RT_valid` — RT (мс) по **правильным реакциям**, прошедшим фильтры:
- `is_correct = True`
- `rt_ms >= min_rt_ms` (не антиципация)
- `rt_ms <= min(timeout_ms, max_rt_ms)` (не timeout/не слишком долго)

## mean_rt
\[
\bar r = \frac{1}{n}\sum_{i=1}^{n} r_i
\]

## median_rt
50-й перцентиль.

## rt_std (выборочное)
\[
s = \sqrt{\frac{1}{n-1}\sum_{i=1}^{n} (r_i-\bar r)^2}
\]

## rt_cv
\[
cv = \frac{s}{\bar r}
\]

## rt_slope (мс/триал)
\[
b = \frac{\sum (x_i-\bar x)(y_i-\bar y)}{\sum (x_i-\bar x)^2}
\]

## accuracy
\[
accuracy=\frac{N_{correct}}{N_{total}}
\]
Для Go/No-Go `correct` включает `correct_inhibition`.

## omission_rate
\[
omission\_rate=\frac{N_{omission}}{N_{required}}
\]
Для Go/No-Go `N_required = N_go`.

## commission_error_rate (Go/No-Go)
\[
commission\_rate=\frac{N_{commission}}{N_{nogo}}
\]

## timeout_rate
\[
timeout\_rate=\frac{N_{timeout}}{N_{required}}
\]

## anticipation_rate
\[
anticipation\_rate=\frac{N_{anticipation}}{N_{total}}
\]

## d′ (Go/No-Go)
\[
d' = Z(hit) - Z(false\ alarm)
\]
log-linear correction:
\[
hit = \frac{H+0.5}{N_{go}+1},\quad fa=\frac{FA+0.5}{N_{nogo}+1}
\]
`Z` — inverse normal CDF (Acklam approximation, без scipy).

## Speed–Accuracy
Корреляция Пирсона между `rt_ms` и `correctness` (0/1) на триалах с реакцией и не timeout.
