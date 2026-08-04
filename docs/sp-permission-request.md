# Permission request to S&P Dow Jones Indices

Send to **index_services@spdji.com**.

Everything below is factual and checkable. The one thing worth deciding before
you send: whether to ask for the San Diego series alone, or for all 20 metros.
Asking for both is one email either way, and the smaller ask is easier to grant,
so the request is written to make San Diego the primary and the other 19 clearly
severable.

---

**Subject:** Permission request: non-commercial reproduction of Case-Shiller indexes (SDXRSA and 19 others)

Hello,

I'm writing to request permission to reproduce S&P CoreLogic Case-Shiller Home
Price Index values on a free, non-commercial website and in its public source
repository.

**What the site is**

[Three Blueberries](https://blueberries.doyled-it.com) is a California
home-buying calculator I built and maintain on my own. It itemises what a house
actually costs each month, including the parts other calculators leave out, and
cites a source for every figure. It carries no advertising, sells nothing,
captures no email addresses and has no commercial relationship with any lender or
brokerage. The source is public at
<https://github.com/doyled-it/three-blueberries> under the AGPL-3.0.

**What I would like to reproduce**

1. **S&P CoreLogic Case-Shiller CA-San Diego Home Price Index (SDXRSA)**,
   monthly, January 1987 to the present, 473 observations. This is the primary
   request.

2. Nineteen further metropolitan indexes, monthly over the same period, used
   only as offline training input for a forecasting model whose coefficients are
   published while the underlying series are not displayed: LXXRSA, SFXRSA,
   SEXRSA, PHXRSA, MIXRSA, TPXRSA, DNXRSA, POXRSA, LVXRSA, WDXRSA, NYXRSA,
   BOXRSA, CHXRSA, DAXRSA, ATXRSA, CRXRSA, CEXRSA, DEXRSA, MNXRSA. If this part
   is not something you grant, I would still be glad of permission for SDXRSA
   alone and will replace the rest.

All values are retrieved from FRED at the Federal Reserve Bank of St. Louis.

**How it would appear**

The index values are committed to the public repository as a data file, and
rendered on the site as two line charts: what a representative San Diego house
cost over time, and what the monthly payment on it would have been at each
month's prevailing mortgage rate. The index is used as a repeat-sales price
series scaled to a current dollar anchor. It is not redistributed as a data
product, offered for download, or exposed through an API.

**Attribution**

Every figure on the site already links to its source. The index is described in
full as the S&P CoreLogic Case-Shiller CA-San Diego Home Price Index, credited to
S&P Dow Jones Indices, with a link back to your page for the index and to the
FRED series. I am happy to carry any specific attribution or disclaimer language
you require, in whatever placement you prefer.

**What I am asking**

Written permission to reproduce these values for this non-commercial use, or a
statement of the terms under which you would grant it. If reproduction is not
something you can permit, please say so plainly and I will move the site to the
FHFA House Price Index instead; I would rather ask than assume.

I am aware that FRED's terms state that making a series available through their
API does not constitute permission from the copyright holder, which is why I am
writing.

Thank you for your time.

Michael Doyle
<https://doyled-it.com>
michaeldoyle1994@gmail.com

---

## If they say yes

Nothing changes in the code. Add the grant to `lib/data/sources.ts` under the
`cshpi-sdxrsa` entry: the date, who granted it, and any attribution wording they
required. Then update the licence section of `README.md`, which currently says
permission "has not been requested here yet", and the matching note in
`CLAUDE.md` section 7a.

## If they say no, or do not reply

The FHFA migration is already written and tested. It is commit `bf50c29`,
reverted in `6b99de2`, so re-applying it is:

```
git revert 6b99de2
```

Read that commit message first. The switch is not free: FHFA publishes MSA data
quarterly rather than monthly, the record starts in 1991 rather than 1987, and
because 1991 was already less affordable than 1987, the thesis headline moves
from "46% of buying power lost" to 22%. The crash depth is preserved almost
exactly, at -41.9% against Case-Shiller's -42%, which is why the expanded-data
flavour was chosen over the longer all-transactions one.

A reasonable middle path if they decline only the 19-metro request: keep SDXRSA
for the site under whatever they grant, and move `data/panel.json` to FHFA, since
the forecaster's conclusion is that it does not work and a coarser input will not
change that.
