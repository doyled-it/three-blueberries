// GENERATED FILE, do not edit by hand.
// Regenerate with: npm run data:panel && npm run train
//
// Trained by training/train.py (scikit-learn) on a panel of 20 Case-Shiller
// metros, 6,723 metro-months. Validated with purged walk-forward folds:
// training rows whose target resolves inside the test window are dropped, so no
// fold can see its own answer.
//
// Scored for San Diego as of 2026-05.
// Trained: 2026-08-03
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
    key: "mom3",
    label: "3-month momentum",
  },
  {
    key: "mom12",
    label: "12-month momentum",
  },
  {
    key: "mom24",
    label: "24-month momentum",
  },
  {
    key: "real_price_z",
    label: "Real price vs own history",
  },
  {
    key: "dev_from_trend",
    label: "Deviation from 10-year trend",
  },
  {
    key: "burden_z",
    label: "Payment burden vs own history",
  },
  {
    key: "rate",
    label: "Mortgage rate level",
  },
  {
    key: "rate_chg12",
    label: "12-month change in rates",
  },
  {
    key: "supply",
    label: "Months' supply of new homes",
  },
  {
    key: "delinquency",
    label: "Mortgage delinquency",
  },
  {
    key: "unemployment",
    label: "Unemployment rate",
  },
  {
    key: "unemp_chg12",
    label: "12-month change in unemployment",
  },
];

export const MODEL_TRAINED = "2026-08-03";
export const MODEL_METROS = 20;
export const MODEL_OBSERVATIONS = 6723;
export const MODEL_SCORED_MONTH = "2026-05";
export const DRAWDOWN_THRESHOLD = -0.1;

export const MODELS = {
  "12": {
    horizon: 12,
    observations: 6483,
    test_predictions: 5295,
    folds: 12,
    up_rate: 0.7537299338999056,
    drawdown_base_rate: 0.06572237960339944,
    models: {
      ridge: {
        r2: -0.6998030246092422,
        skill_vs_mean: -0.3839529689043264,
        skill_vs_momentum: -0.7776583156023316,
        rmse: 0.1303578264915353,
        directional_accuracy: 0.7718602455146365,
        r2_rising: -0.09424612169403179,
        r2_falling: -2.3449030096189416,
      },
      gradient_boosting: {
        r2: 0.05712595298309986,
        skill_vs_mean: 0.23232673563935402,
        skill_vs_momentum: 0.013939929521817995,
        rmse: 0.09708779834643674,
        directional_accuracy: 0.7063267233238905,
        r2_rising: 0.05362693496843385,
        r2_falling: -0.5208910356077296,
      },
      random_forest: {
        r2: -0.19387996519079453,
        skill_vs_mean: 0.02796165295621489,
        skill_vs_momentum: -0.24856269651615892,
        rmse: 0.10924916944312725,
        directional_accuracy: 0.7031161473087819,
        r2_rising: -0.07037565611764185,
        r2_falling: -1.0518661805987306,
      },
    },
    classifiers: {
      logistic: {
        auc: 0.15547475655743992,
        brier: 0.12277480135452455,
        pre_crash_prob: 0.0,
        pre_crash_actual: 0.0,
      },
      gradient_boosting: {
        auc: 0.1634440006598682,
        brier: 0.09815029231874368,
        pre_crash_prob: 0.0,
        pre_crash_actual: 0.0,
      },
    },
    pre_crash: {
      ridge: {
        predicted: 0.12851431891616827,
        flagged_negative: 0.0035087719298245615,
      },
      gradient_boosting: {
        predicted: 0.12138301998767606,
        flagged_negative: 0.0,
      },
      random_forest: {
        predicted: 0.1160422787800817,
        flagged_negative: 0.0,
      },
    },
    final: {
      coefficients: [
        0.04074406804229886, 0.001129208213104071, 0.01264669615941146, 0.011067070373821665, -0.03871375238393799,
        -0.0022663765613345353, -0.018411884416893076, 0.006039020298225661, -0.028355073248605697,
        -0.034173639147828457, 0.015873102582489508, 0.010367680600017828,
      ],
      intercept: 0.04626415921444448,
      classifier_coefficients: [
        -0.8786958161878575, -1.033983073721517, 0.30149426337304736, -0.22693905654987295, 1.1319815372472177,
        -0.11084890797164065, 0.6895837146755512, -0.6497310510216678, 1.0773085139448622, 0.0956685607352259,
        -0.3311278023533417, -1.1275766263753046,
      ],
      classifier_intercept: -4.948396477475165,
      scaler_mean: [
        0.011802146211505233, 0.04757498620944543, 0.0949997217666109, 1.0110607749087048, 0.09822676780061435,
        -0.03960187675004013, 5.320827394724664, -0.03285755051673609, 5.953293228443622, 4.115548357242018,
        5.586811661267932, -0.04260373283973465,
      ],
      scaler_scale: [
        0.026772394323090427, 0.09353822660351647, 0.16417993138844567, 1.2600301630188815, 0.21381333617797624,
        1.4472915088984066, 1.4611908846753676, 0.8538696402813221, 1.9711398052049052, 3.0991295351455705,
        1.907981983315419, 1.7003721022109013,
      ],
      current: {
        ridge: -0.052207675327480114,
        gradient_boosting: -0.009736715768711266,
        crash_probability_logistic: 0.22938011816706833,
        crash_probability_gbm: 0.02581122886786135,
      },
      current_features: {
        mom3: -0.013500201385635863,
        mom12: 0.009561202546091668,
        mom24: 0.011510734914136208,
        real_price_z: 1.45343052416778,
        dev_from_trend: 0.10963389381004204,
        burden_z: 1.790541338189676,
        rate: 6.4425,
        rate_chg12: -0.37349999999999994,
        supply: 9.4,
        delinquency: 1.89,
        unemployment: 4.3,
        unemp_chg12: 0.0,
      },
    },
  },
  "24": {
    horizon: 24,
    observations: 6243,
    test_predictions: 5055,
    folds: 11,
    up_rate: 0.7673590504451039,
    drawdown_base_rate: 0.13452027695351138,
    models: {
      ridge: {
        r2: -1.8908060047650395,
        skill_vs_mean: -1.1005460216240563,
        skill_vs_momentum: -2.0849914264125458,
        rmse: 0.2975418347095822,
        directional_accuracy: 0.6079129574678536,
        r2_rising: -1.971269207894712,
        r2_falling: -3.034927006486572,
      },
      gradient_boosting: {
        r2: -0.10103143390903147,
        skill_vs_mean: 0.19995766081556043,
        skill_vs_momentum: -0.17499151732118756,
        rmse: 0.1836277959866317,
        directional_accuracy: 0.6544015825914936,
        r2_rising: -0.2415937181190293,
        r2_falling: -0.4169013336401033,
      },
      random_forest: {
        r2: -0.41121107437174054,
        skill_vs_mean: -0.025428134249466883,
        skill_vs_momentum: -0.5060069953220916,
        rmse: 0.20789045535531026,
        directional_accuracy: 0.5762611275964392,
        r2_rising: -0.5156102911161067,
        r2_falling: -0.8987074812398235,
      },
    },
    classifiers: {
      logistic: {
        auc: 0.13258890756302522,
        brier: 0.20519602240408796,
        pre_crash_prob: 0.0,
        pre_crash_actual: 0.1543859649122807,
      },
      gradient_boosting: {
        auc: 0.20336184873949575,
        brier: 0.18125881392878437,
        pre_crash_prob: 0.0,
        pre_crash_actual: 0.1543859649122807,
      },
    },
    pre_crash: {
      ridge: {
        predicted: 0.22883036516792282,
        flagged_negative: 0.005263157894736842,
      },
      gradient_boosting: {
        predicted: 0.15804110562921125,
        flagged_negative: 0.0,
      },
      random_forest: {
        predicted: 0.1490395658768986,
        flagged_negative: 0.0,
      },
    },
    final: {
      coefficients: [
        0.04031809323762248, 0.011174143495356358, 0.029791912690786078, 0.031856684360916106, -0.09102522978354434,
        -0.03046677443517529, -0.034948290179044876, 0.010663962052045966, -0.0536782408931169, -0.05799392705364871,
        0.004881573219408246, 0.031072507776532567,
      ],
      intercept: 0.09356748058795765,
      classifier_coefficients: [
        -0.6001116021131178, -0.3657917229839965, -0.25615256272474585, 0.05639071346866677, 1.3853803397446198,
        -0.07710808819323824, 1.1123985836503565, -0.5695950076129597, 1.1461641980636141, 0.01671637696842152,
        0.5513580192758273, -0.8557008472480316,
      ],
      classifier_intercept: -3.37003275990209,
      scaler_mean: [
        0.01200772805882415, 0.04797664768725186, 0.0957158926312264, 0.9877599393520221, 0.09544266802090444,
        -0.11024206820978334, 5.267818356559346, -0.02269814191894923, 5.848566394361686, 4.205982700624699,
        5.641790805702386, -0.059282396283837885,
      ],
      scaler_scale: [
        0.02719210086566375, 0.09518490940528897, 0.167002847176464, 1.2755440690701212, 0.21707603762736227,
        1.4242373853080474, 1.4626739382576799, 0.8639614361709236, 1.9297768965898134, 3.12296368371636,
        1.923138935067865, 1.7303839659832023,
      ],
      current: {
        ridge: -0.08928244719572027,
        gradient_boosting: -0.20534388061813713,
        crash_probability_logistic: 0.5708984715791936,
        crash_probability_gbm: 0.7352714236700891,
      },
      current_features: {
        mom3: -0.013500201385635863,
        mom12: 0.009561202546091668,
        mom24: 0.011510734914136208,
        real_price_z: 1.45343052416778,
        dev_from_trend: 0.10963389381004204,
        burden_z: 1.790541338189676,
        rate: 6.4425,
        rate_chg12: -0.37349999999999994,
        supply: 9.4,
        delinquency: 1.89,
        unemployment: 4.3,
        unemp_chg12: 0.0,
      },
    },
  },
  "36": {
    horizon: 36,
    observations: 6003,
    test_predictions: 4815,
    folds: 11,
    up_rate: 0.7715472481827622,
    drawdown_base_rate: 0.18442367601246107,
    models: {
      ridge: {
        r2: -6.79754453435312,
        skill_vs_mean: -4.00100796978108,
        skill_vs_momentum: -6.415703332473866,
        rmse: 0.6447240989072216,
        directional_accuracy: 0.41079958463136035,
        r2_rising: -5.834875326825608,
        r2_falling: -10.757875565980463,
      },
      gradient_boosting: {
        r2: -0.46231354339956376,
        skill_vs_mean: 0.06213531033500985,
        skill_vs_momentum: -0.39070490320828033,
        rmse: 0.279199877289156,
        directional_accuracy: 0.5736240913811007,
        r2_rising: -0.41221195792015575,
        r2_falling: -0.9986734939288959,
      },
      random_forest: {
        r2: -0.8700765394090353,
        skill_vs_mean: -0.1993862473606336,
        skill_vs_momentum: -0.7784999834473216,
        rmse: 0.31573640728479047,
        directional_accuracy: 0.46812045690550363,
        r2_rising: -0.9293642368057555,
        r2_falling: -1.3608469064799946,
      },
    },
    classifiers: {
      logistic: {
        auc: 0.12320413423354598,
        brier: 0.4007089190223556,
        pre_crash_prob: 0.0,
        pre_crash_actual: 0.4070175438596491,
      },
      gradient_boosting: {
        auc: 0.11341412076706192,
        brier: 0.27207216437191123,
        pre_crash_prob: 0.0,
        pre_crash_actual: 0.4070175438596491,
      },
    },
    pre_crash: {
      ridge: {
        predicted: 0.24166067502406946,
        flagged_negative: 0.005263157894736842,
      },
      gradient_boosting: {
        predicted: 0.18301925099097952,
        flagged_negative: 0.0,
      },
      random_forest: {
        predicted: 0.20881734058165863,
        flagged_negative: 0.0,
      },
    },
    final: {
      coefficients: [
        0.0356554259543763, 0.03913985176621636, 0.006916864134981547, 0.044065170548256455, -0.10166332267527203,
        -0.07522972898517089, -0.033699151226696485, 0.0120642770692895, -0.07255812603526259, -0.03857229570353743,
        -0.03673198008343634, 0.044206757100222704,
      ],
      intercept: 0.14046666636780603,
      classifier_coefficients: [
        -0.25632893847776056, -0.19556007087160707, -0.5184952698501226, -0.041749260877823054, 1.386770725412393,
        0.37655734500990196, 1.1436674366353952, -0.6328578219717633, 1.3115472093312879, -0.32747073754745853,
        0.7713583028058193, -0.6362574408993112,
      ],
      classifier_intercept: -2.903007228376532,
      scaler_mean: [
        0.011876526732642308, 0.048325796614966325, 0.09535484287126063, 0.9608683792596602, 0.09121919987914462,
        -0.19596337657631993, 5.198691487589538, -0.05639755122438784, 5.761452607029819, 4.305607196401799,
        5.716808262535399, -0.07059803431617524,
      ],
      scaler_scale: [
        0.027642676442025064, 0.0967440675992345, 0.16968076137256918, 1.2887315478732941, 0.21984900384559827,
        1.3777249273419505, 1.4482148975242348, 0.8593482516071297, 1.9145157795665582, 3.143985356465159,
        1.9233432826791086, 1.763441303123343,
      ],
      current: {
        ridge: -0.12433945154475051,
        gradient_boosting: -0.19900698148386514,
        crash_probability_logistic: 0.8424160617992397,
        crash_probability_gbm: 0.795082202185312,
      },
      current_features: {
        mom3: -0.013500201385635863,
        mom12: 0.009561202546091668,
        mom24: 0.011510734914136208,
        real_price_z: 1.45343052416778,
        dev_from_trend: 0.10963389381004204,
        burden_z: 1.790541338189676,
        rate: 6.4425,
        rate_chg12: -0.37349999999999994,
        supply: 9.4,
        delinquency: 1.89,
        unemployment: 4.3,
        unemp_chg12: 0.0,
      },
    },
  },
} as const;

export const MODEL_HORIZONS = [12, 24, 36];
