// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run data:panel && npm run train
//
// Trained by training/train.py (scikit-learn) on a panel of 20 metros from
// FHFA's all-transactions house price index, 2,800 metro-quarters. Validated
// with purged walk-forward folds: training rows whose target resolves inside the
// test window are dropped, so no fold can see its own answer.
//
// Scored for San Diego as of 2026Q1.
// Trained: 2026-08-17
//
// READ THE VALIDATION NUMBERS BEFORE TRUSTING THE FORECAST. In particular check
// `preCrash`, which reports what each model would have said going into 2008, and
// `upRate`, which is the accuracy of simply always predicting "prices rise".

export interface FeatureSpec {
  key: string;
  label: string;
}

export const MODEL_FEATURES: readonly FeatureSpec[] = [
  {
    "key": "mom3",
    "label": "3-month momentum"
  },
  {
    "key": "mom12",
    "label": "12-month momentum"
  },
  {
    "key": "mom24",
    "label": "24-month momentum"
  },
  {
    "key": "real_price_z",
    "label": "Real price vs own history"
  },
  {
    "key": "dev_from_trend",
    "label": "Deviation from 10-year trend"
  },
  {
    "key": "burden_z",
    "label": "Payment burden vs own history"
  },
  {
    "key": "rate",
    "label": "Mortgage rate level"
  },
  {
    "key": "rate_chg12",
    "label": "12-month change in rates"
  },
  {
    "key": "supply",
    "label": "Months' supply of new homes"
  },
  {
    "key": "delinquency",
    "label": "Mortgage delinquency"
  },
  {
    "key": "unemployment",
    "label": "Unemployment rate"
  },
  {
    "key": "unemp_chg12",
    "label": "12-month change in unemployment"
  }
];

export const MODEL_TRAINED = "2026-08-17";
export const MODEL_METROS = 20;
export const MODEL_OBSERVATIONS = 2800;
export const MODEL_SCORED_MONTH = "2026Q1";
export const DRAWDOWN_THRESHOLD = -0.1;

export const MODELS = {
  "12": {
    "horizon": 12,
    "observations": 2720,
    "test_predictions": 1760,
    "folds": 12,
    "up_rate": 0.7607954545454545,
    "drawdown_base_rate": 0.04602272727272727,
    "models": {
      "ridge": {
        "r2": -0.47571001471495555,
        "skill_vs_mean": -0.32757858174285603,
        "skill_vs_momentum": -1.1334939280425096,
        "rmse": 0.10448604639420987,
        "directional_accuracy": 0.8647727272727272,
        "r2_rising": 0.10952744106036172,
        "r2_falling": -3.2131845014849
      },
      "gradient_boosting": {
        "r2": 0.4067576004517556,
        "skill_vs_mean": 0.46630713651820455,
        "skill_vs_momentum": 0.1423253588625789,
        "rmse": 0.06624816839205835,
        "directional_accuracy": 0.8284090909090909,
        "r2_rising": 0.09292280015824506,
        "r2_falling": 0.079085467390408
      },
      "random_forest": {
        "r2": 0.15272859697444774,
        "skill_vs_mean": 0.23777750617406368,
        "skill_vs_momentum": -0.22493469295065727,
        "rmse": 0.0791715337364748,
        "directional_accuracy": 0.75625,
        "r2_rising": -0.3392378418507218,
        "r2_falling": -0.25368594892727736
      }
    },
    "classifiers": {
      "logistic": {
        "auc": 0.3342267222553107,
        "brier": 0.06135124548836639,
        "pre_crash_prob": 0.0,
        "pre_crash_actual": 0.0
      },
      "gradient_boosting": {
        "auc": 0.3185979308671387,
        "brier": 0.06183829797470395,
        "pre_crash_prob": 0.0,
        "pre_crash_actual": 0.0
      }
    },
    "pre_crash": {
      "ridge": {
        "predicted": 0.11041844241200342,
        "flagged_negative": 0.005
      },
      "gradient_boosting": {
        "predicted": 0.11532531365423493,
        "flagged_negative": 0.0
      },
      "random_forest": {
        "predicted": 0.10323987545460256,
        "flagged_negative": 0.0
      }
    },
    "final": {
      "coefficients": [
        0.0241194493759775,
        0.023220971892830802,
        0.0004972297367403442,
        0.0003107243958727067,
        -0.01812295278592457,
        0.00451277655257827,
        -0.01305460678097988,
        0.007111067896602973,
        -0.02549518900844379,
        -0.014881388659982663,
        0.009275278978869482,
        0.007934730128733082
      ],
      "intercept": 0.04519321329936176,
      "classifier_coefficients": [
        -0.5808912007237083,
        -0.762648620890869,
        -0.2163565662015582,
        0.2791527723958206,
        0.5166247052695466,
        -0.0327125075322797,
        -0.09711165559608774,
        -0.20845008927803305,
        0.774099341562962,
        -0.06848511658857499,
        -0.2059933099782879,
        -0.283350995975055
      ],
      "classifier_intercept": -5.088731990063341,
      "scaler_mean": [
        0.011246111168845305,
        0.04464924316096698,
        0.08899588251965035,
        1.0297789238657862,
        0.08379624969173784,
        -0.3823643411201429,
        5.87737,
        -0.09927279411764711,
        5.866230882352942,
        3.800764705882353,
        5.717789264705883,
        -0.04740161764705884
      ],
      "scaler_scale": [
        0.02160741813739999,
        0.0738240382197896,
        0.13537648893374446,
        1.2137124934791823,
        0.18757443731066742,
        1.1736031934000546,
        1.7382163026098978,
        0.8732822258807582,
        1.7838386420909456,
        2.849885240814645,
        1.7597617904686922,
        1.5379358960806089
      ],
      "current": {
        "ridge": -0.017775892323563434,
        "gradient_boosting": -0.02584050742424086,
        "crash_probability_logistic": 0.06936221295274303,
        "crash_probability_gbm": 0.00042312169866585893
      },
      "current_features": {
        "mom3": 0.004207874923278695,
        "mom12": 0.02420765426913391,
        "mom24": 0.05352790746840767,
        "real_price_z": 1.6948614564545017,
        "dev_from_trend": 0.14118604423234232,
        "burden_z": 1.886767416885108,
        "rate": 6.1092,
        "rate_chg12": -0.7184999999999997,
        "supply": 9.3,
        "delinquency": 1.89,
        "unemployment": 4.3333,
        "unemp_chg12": 0.20000000000000018
      }
    }
  },
  "24": {
    "horizon": 24,
    "observations": 2640,
    "test_predictions": 1680,
    "folds": 11,
    "up_rate": 0.7553571428571428,
    "drawdown_base_rate": 0.11428571428571428,
    "models": {
      "ridge": {
        "r2": -1.7701076548022017,
        "skill_vs_mean": -1.3716755912596619,
        "skill_vs_momentum": -2.4448617033954996,
        "rmse": 0.2619171453594334,
        "directional_accuracy": 0.8184523809523809,
        "r2_rising": -0.3738253590983418,
        "r2_falling": -6.668164859836614
      },
      "gradient_boosting": {
        "r2": 0.14323169406115666,
        "skill_vs_mean": 0.266462992859699,
        "skill_vs_momentum": -0.06546340200720735,
        "rmse": 0.14566234631124184,
        "directional_accuracy": 0.7761904761904762,
        "r2_rising": -0.22992308284022522,
        "r2_falling": -0.09905858093823472
      },
      "random_forest": {
        "r2": 0.027535134781869752,
        "skill_vs_mean": 0.16740738209319095,
        "skill_vs_momentum": -0.20934179806337117,
        "rmse": 0.15518600914713387,
        "directional_accuracy": 0.7547619047619047,
        "r2_rising": -0.47359804748113743,
        "r2_falling": -0.12481540587055262
      }
    },
    "classifiers": {
      "logistic": {
        "auc": 0.6101905521953406,
        "brier": 0.10397870513892928,
        "pre_crash_prob": 0.0040311205092634925,
        "pre_crash_actual": 0.065
      },
      "gradient_boosting": {
        "auc": 0.6199544270833334,
        "brier": 0.13646042663585847,
        "pre_crash_prob": 0.0005235955664466057,
        "pre_crash_actual": 0.065
      }
    },
    "pre_crash": {
      "ridge": {
        "predicted": 0.19970190110460131,
        "flagged_negative": 0.0
      },
      "gradient_boosting": {
        "predicted": 0.18019198369712744,
        "flagged_negative": 0.005
      },
      "random_forest": {
        "predicted": 0.17762990787020208,
        "flagged_negative": 0.005
      }
    },
    "final": {
      "coefficients": [
        0.0361848665426087,
        0.037886107118221296,
        -0.00021335158278730786,
        -0.00015142960435308338,
        -0.04604079761791436,
        0.0007753545259267361,
        -0.029713870751084854,
        0.01155991125567741,
        -0.05164487395618669,
        -0.02766079654871633,
        0.0056029235131291955,
        0.025466710044789207
      ],
      "intercept": 0.09141717615421892,
      "classifier_coefficients": [
        -0.7555426493187658,
        -0.7072658473404214,
        -0.057222994962677354,
        0.6343509416748275,
        0.7835106687757607,
        -0.010126318599437871,
        0.03208108128578208,
        -0.3815452392624067,
        0.8636507874911409,
        -0.04793882054124656,
        0.08449389925832113,
        -0.2256717154141122
      ],
      "classifier_intercept": -3.820802433524417,
      "scaler_mean": [
        0.0112414439044486,
        0.044427305132029235,
        0.08827158799531783,
        1.004055762030039,
        0.08050534259184704,
        -0.4446144382725124,
        5.8508016666666665,
        -0.10727181818181816,
        5.7899551515151515,
        3.8629696969696976,
        5.769692121212121,
        -0.05838393939393935
      ],
      "scaler_scale": [
        0.021827039776185345,
        0.07480240358740087,
        0.1366391427836655,
        1.2181284163972992,
        0.1886577169186671,
        1.1278463657435611,
        1.757048701903524,
        0.8732764548351349,
        1.7524509966574195,
        2.869909981534618,
        1.7600272329930915,
        1.5593154397429805
      ],
      "current": {
        "ridge": -0.04096067537384569,
        "gradient_boosting": -0.08552107951407201,
        "crash_probability_logistic": 0.2988937183629811,
        "crash_probability_gbm": 0.13057264008924085
      },
      "current_features": {
        "mom3": 0.004207874923278695,
        "mom12": 0.02420765426913391,
        "mom24": 0.05352790746840767,
        "real_price_z": 1.6948614564545017,
        "dev_from_trend": 0.14118604423234232,
        "burden_z": 1.886767416885108,
        "rate": 6.1092,
        "rate_chg12": -0.7184999999999997,
        "supply": 9.3,
        "delinquency": 1.89,
        "unemployment": 4.3333,
        "unemp_chg12": 0.20000000000000018
      }
    }
  },
  "36": {
    "horizon": 36,
    "observations": 2560,
    "test_predictions": 1600,
    "folds": 11,
    "up_rate": 0.753125,
    "drawdown_base_rate": 0.1675,
    "models": {
      "ridge": {
        "r2": -0.9564059130485674,
        "skill_vs_mean": -0.6008692712431336,
        "skill_vs_momentum": -0.9846350256300582,
        "rmse": 0.29876360281694214,
        "directional_accuracy": 0.63875,
        "r2_rising": -0.8704144107436176,
        "r2_falling": -2.4477861930497715
      },
      "gradient_boosting": {
        "r2": -0.09312675831301087,
        "skill_vs_mean": 0.10552660606609177,
        "skill_vs_momentum": -0.10889955787390249,
        "rmse": 0.22332300720660575,
        "directional_accuracy": 0.675,
        "r2_rising": -0.33199474767031956,
        "r2_falling": -0.4021784355213225
      },
      "random_forest": {
        "r2": -0.21196688312261114,
        "skill_vs_mean": 0.008283236104111413,
        "skill_vs_momentum": -0.2294544348420775,
        "rmse": 0.23514924088360495,
        "directional_accuracy": 0.66,
        "r2_rising": -0.4333072615077458,
        "r2_falling": -0.6340929913174358
      }
    },
    "classifiers": {
      "logistic": {
        "auc": 0.42400329433911527,
        "brier": 0.19020733662368364,
        "pre_crash_prob": 0.0060320347913584114,
        "pre_crash_actual": 0.24
      },
      "gradient_boosting": {
        "auc": 0.4307558491327148,
        "brier": 0.1847075299805326,
        "pre_crash_prob": 0.0006656362570015728,
        "pre_crash_actual": 0.24
      }
    },
    "pre_crash": {
      "ridge": {
        "predicted": 0.2688314618432936,
        "flagged_negative": 0.0
      },
      "gradient_boosting": {
        "predicted": 0.19672596550883958,
        "flagged_negative": 0.0
      },
      "random_forest": {
        "predicted": 0.21569053724669504,
        "flagged_negative": 0.0
      }
    },
    "final": {
      "coefficients": [
        0.041747417300728555,
        0.05461901345325671,
        -0.022727743163576144,
        -0.00830646002341524,
        -0.058660836276395095,
        -0.006430833092608724,
        -0.03573121387000324,
        0.008660227752933528,
        -0.07298172796477613,
        -0.01768264084364133,
        -0.0187041893928699,
        0.03402359852771669
      ],
      "intercept": 0.1383308025267601,
      "classifier_coefficients": [
        -0.5318748276585722,
        -0.599253578886063,
        -0.03644863019862774,
        0.8774062286275364,
        0.7297730826980092,
        0.18208769003128628,
        0.16457352335656594,
        -0.3593658968240927,
        0.957741203781282,
        -0.07403514088593892,
        0.08782259900146386,
        -0.17833873126229707
      ],
      "classifier_intercept": -3.244642191483781,
      "scaler_mean": [
        0.011028135731105922,
        0.04391177080157041,
        0.0853235097725726,
        0.9759134478287314,
        0.07623368106768041,
        -0.5090719954373213,
        5.82771953125,
        -0.14851921875,
        5.720161718750001,
        3.9288906249999997,
        5.834683125,
        -0.052916562499999965
      ],
      "scaler_scale": [
        0.021863460258433047,
        0.07495194645873017,
        0.13677082078809188,
        1.21949610739744,
        0.1890722384095108,
        1.072106037329704,
        1.773496805821526,
        0.8421856715134226,
        1.728851382580403,
        2.8896490683190423,
        1.7477468317440843,
        1.5766679975923703
      ],
      "current": {
        "ridge": -0.05183680060594953,
        "gradient_boosting": -0.13159708090305278,
        "crash_probability_logistic": 0.6136861706126787,
        "crash_probability_gbm": 0.5847450510653339
      },
      "current_features": {
        "mom3": 0.004207874923278695,
        "mom12": 0.02420765426913391,
        "mom24": 0.05352790746840767,
        "real_price_z": 1.6948614564545017,
        "dev_from_trend": 0.14118604423234232,
        "burden_z": 1.886767416885108,
        "rate": 6.1092,
        "rate_chg12": -0.7184999999999997,
        "supply": 9.3,
        "delinquency": 1.89,
        "unemployment": 4.3333,
        "unemp_chg12": 0.20000000000000018
      }
    }
  }
} as const;

export const MODEL_HORIZONS = [12, 24, 36];
