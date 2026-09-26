"""PMLATE: each resolution station's time zone (the local civil day the sources' "this day" means).

Hand-mapped from the station list of fp4's WX universe and the markets listed since; a station missing here stops the
script that meets it, rather than being given a guessed day.
"""
TZ = {
    "EGLC": "Europe/London", "EGLL": "Europe/London", "KLGA": "America/New_York", "KJFK": "America/New_York",
    "KNYC": "America/New_York", "KMIA": "America/New_York", "RKSI": "Asia/Seoul", "RJTT": "Asia/Tokyo",
    "RJAA": "Asia/Tokyo", "ZSPD": "Asia/Shanghai", "HKO": "Asia/Hong_Kong", "VHHH": "Asia/Hong_Kong",
    "CYYZ": "America/Toronto", "KATL": "America/New_York", "KDAL": "America/Chicago", "KDFW": "America/Chicago",
    "KSEA": "America/Los_Angeles", "SAEZ": "America/Argentina/Buenos_Aires", "LFPB": "Europe/Paris",
    "LFPG": "Europe/Paris", "LFPO": "Europe/Paris", "LTAC": "Europe/Istanbul", "LTFM": "Europe/Istanbul",
    "NZWN": "Pacific/Auckland", "NZAA": "Pacific/Auckland", "KORD": "America/Chicago", "KMDW": "America/Chicago",
    "SBGR": "America/Sao_Paulo", "VILK": "Asia/Kolkata", "VIDP": "Asia/Kolkata", "VABB": "Asia/Kolkata",
    "EDDM": "Europe/Berlin", "EDDB": "Europe/Berlin", "EDDF": "Europe/Berlin", "WSSS": "Asia/Singapore",
    "LEMD": "Europe/Madrid", "LEBL": "Europe/Madrid", "LIMC": "Europe/Rome", "LIRF": "Europe/Rome",
    "EPWA": "Europe/Warsaw", "ZBAA": "Asia/Shanghai", "ZUCK": "Asia/Shanghai", "ZGSZ": "Asia/Shanghai",
    "ZHHH": "Asia/Shanghai", "ZUUU": "Asia/Shanghai", "KHOU": "America/Chicago", "KIAH": "America/Chicago",
    "KLAX": "America/Los_Angeles", "KSFO": "America/Los_Angeles", "KAUS": "America/Chicago",
    "KBKF": "America/Denver", "KDEN": "America/Denver", "MMMX": "America/Mexico_City", "EHAM": "Europe/Amsterdam",
    "RKPK": "Asia/Seoul", "EFHK": "Europe/Helsinki", "WMKK": "Asia/Kuala_Lumpur", "MPMG": "America/Panama",
    "MPTO": "America/Panama", "RCSS": "Asia/Taipei", "RCTP": "Asia/Taipei", "OEJN": "Asia/Riyadh",
    "OERK": "Asia/Riyadh", "FACT": "Africa/Johannesburg", "FAOR": "Africa/Johannesburg", "ZGGG": "Asia/Shanghai",
    "OPKC": "Asia/Karachi", "RPLL": "Asia/Manila", "ZSQD": "Asia/Shanghai", "ZSJN": "Asia/Shanghai",
    "ZHCC": "Asia/Shanghai", "WIHH": "Asia/Jakarta", "WIII": "Asia/Jakarta", "DNMM": "Africa/Lagos",
    "LLBG": "Asia/Jerusalem", "KPHX": "America/Phoenix", "KBOS": "America/New_York", "KDCA": "America/New_York",
    "KIAD": "America/New_York", "KPHL": "America/New_York", "KMSP": "America/Chicago", "KLAS": "America/Los_Angeles",
    "KSAN": "America/Los_Angeles", "KMCO": "America/New_York", "KTPA": "America/New_York", "KCLT": "America/New_York",
    "KDTW": "America/Detroit", "KSLC": "America/Denver", "KPDX": "America/Los_Angeles", "KBNA": "America/Chicago",
    "KMSY": "America/Chicago", "KSTL": "America/Chicago", "KMCI": "America/Chicago", "KOKC": "America/Chicago",
    "KSAT": "America/Chicago", "KRDU": "America/New_York", "KPIT": "America/New_York", "KCLE": "America/New_York",
    "KCVG": "America/New_York", "KIND": "America/Indiana/Indianapolis", "KJAX": "America/New_York",
    "KBWI": "America/New_York", "KHNL": "Pacific/Honolulu", "PANC": "America/Anchorage", "CYVR": "America/Vancouver",
    "CYUL": "America/Toronto", "CYYC": "America/Edmonton", "EIDW": "Europe/Dublin", "EGCC": "Europe/London",
    "EBBR": "Europe/Brussels", "LOWW": "Europe/Vienna", "LSZH": "Europe/Zurich", "EKCH": "Europe/Copenhagen",
    "ESSA": "Europe/Stockholm", "ENGM": "Europe/Oslo", "LPPT": "Europe/Lisbon", "LGAV": "Europe/Athens",
    "LKPR": "Europe/Prague", "LHBP": "Europe/Budapest", "UUEE": "Europe/Moscow", "UUWW": "Europe/Moscow",
    "OMDB": "Asia/Dubai", "OTHH": "Asia/Qatar", "OKBK": "Asia/Kuwait", "VTBS": "Asia/Bangkok", "VVNB": "Asia/Bangkok",
    "VVTS": "Asia/Ho_Chi_Minh", "YSSY": "Australia/Sydney", "YMML": "Australia/Melbourne", "YBBN": "Australia/Brisbane",
    "YPPH": "Australia/Perth", "SCEL": "America/Santiago", "SKBO": "America/Bogota", "SPJC": "America/Lima",
    "HECA": "Africa/Cairo", "HKJK": "Africa/Nairobi", "GMMN": "Africa/Casablanca", "ZSSS": "Asia/Shanghai",
    "ZSHC": "Asia/Shanghai", "ZSNJ": "Asia/Shanghai", "ZLXY": "Asia/Shanghai", "ZYTX": "Asia/Shanghai",
    "ZBTJ": "Asia/Shanghai", "ZSAM": "Asia/Shanghai", "ZGHA": "Asia/Shanghai", "ZPPP": "Asia/Shanghai",
    "RKSS": "Asia/Seoul", "RJBB": "Asia/Tokyo", "RJCC": "Asia/Tokyo", "RJFF": "Asia/Tokyo", "VECC": "Asia/Kolkata",
    "VOMM": "Asia/Kolkata", "VOBL": "Asia/Kolkata", "OPLA": "Asia/Karachi", "VGHS": "Asia/Dhaka", "LEPA": "Europe/Madrid",
}


def tz_of(station):
    if station not in TZ:
        raise KeyError(f"no time zone for station {station}: add it to stations.py")
    return TZ[station]
